const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
const axios = require('axios'); 
require('dotenv').config();

const app = express();

// --- CONFIGURAÇÃO DO CORS CORRIGIDA ---
app.use(cors({
  origin: [
    'https://meu-imovel-app.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// --- CONEXÃO COM MONGODB ---
async function connectDB() {
  try {
    if (!process.env.MONGO_URI) {
      console.error("❌ ERRO: Variável MONGO_URI não encontrada no arquivo .env");
      return;
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ BANCO CONECTADO");
  } catch (_err) {
    console.error("❌ ERRO NA CONEXÃO INICIAL DO MONGO:", _err.message);
    setTimeout(connectDB, 5000);
  }
}

connectDB();

mongoose.connection.on('error', err => {
  console.error("❌ ERRO DE CONEXÃO DURANTE A EXECUÇÃO:", err);
});

mongoose.connection.on('disconnected', () => {
  console.warn("⚠️ MONGO DESCONECTADO. O Mongoose tentará reconectar automaticamente...");
});

// --- MODELOS ---

const User = mongoose.model('User', new mongoose.Schema({
  nome: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  cpf: { type: String, required: true, unique: true },
  creci: { type: String }, 
  telefone: { type: String, required: true },
  senha: { type: String, required: true },
  isSubscriptionActive: { type: Boolean, default: false },
  subscriptionExpires: { type: Date },
  createdAt: { type: Date, default: Date.now }
}));

const Imovel = mongoose.model('Imovel', new mongoose.Schema({
  titulo: String,
  preco: Number,
  localizacao: String,
  contato: String,
  imagemUrl: String,
  tipoNegocio: { type: String, enum: ['venda', 'aluguel'], default: 'venda' },
  tipoImovel: { type: String, enum: ['casa', 'apto', 'terreno'], default: 'casa' },
  anuncianteTipo: String, 
  comissao: Number, 
  status: { type: String, default: 'disponivel' }, 
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}));

const Venda = mongoose.model('Venda', new mongoose.Schema({
  imovelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Imovel' },
  vendedorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  valorVenda: Number,
  comissaoSite: Number, 
  pago: { type: Boolean, default: false },
  dataVenda: { type: Date, default: Date.now }
}));

// --- MIDDLEWARE DE PROTEÇÃO ---
const auth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: "Acesso negado. Faça login." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_para_dev'); 
    req.user = decoded;
    next();
  } catch (ex) {
    res.status(400).json({ message: "Token inválido." });
  }
};

// --- INTEGRAÇÃO GOOGLE SHEETS ---
const enviarParaGoogleSheets = async (dados) => {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK;
  if (!webhookUrl) return;

  try {
    await axios.post(webhookUrl, dados);
    console.log("✅ Lead enviado com sucesso para o Google Sheets!");
  } catch (err) {
    console.error("❌ Erro ao enviar lead para o Webhook:", err.message);
  }
};

// --- ROTAS DE USUÁRIOS (AUTH) ---

app.post('/auth/register', async (req, res) => {
  try {
    const { nome, email, cpf, creci, telefone, senha } = req.body;
    let user = await User.findOne({ $or: [{ email }, { cpf }] });
    if (user) return res.status(400).json({ message: "Usuário ou CPF já cadastrado." });

    const salt = await bcrypt.genSalt(10);
    const senhaHashed = await bcrypt.hash(senha, salt);

    user = new User({ nome, email, cpf, creci, telefone, senha: senhaHashed });
    await user.save();

    enviarParaGoogleSheets({ nome, email, cpf, telefone });
    res.json({ message: "Cadastro realizado com sucesso!" });
  } catch (err) {
    res.status(500).json({ message: "Erro interno: " + err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "E-mail ou senha inválidos." });

    const senhaValida = await bcrypt.compare(senha, user.senha);
    if (!senhaValida) return res.status(400).json({ message: "E-mail ou senha inválidos." });

    const token = jwt.sign({ id: user._id, nome: user.nome }, process.env.JWT_SECRET || 'fallback_secret_para_dev');
    
    res.json({ 
      token, 
      user: { 
        id: user._id, 
        nome: user.nome, 
        isSubscriptionActive: user.isSubscriptionActive,
        subscriptionExpires: user.subscriptionExpires 
      } 
    });
  } catch (err) {
    res.status(500).json({ message: "Erro ao fazer login." });
  }
});

// --- ROTAS DE IMÓVEIS ---

app.get('/imoveis', async (req, res) => {
  try {
    const imoveis = await Imovel.find().populate('criadoPor', 'nome email');
    res.json(imoveis);
  } catch (err) {
    res.status(500).json({ message: "Erro ao carregar imóveis." });
  }
});

app.get('/imoveis/matches', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const hoje = new Date();
    if (!user.isSubscriptionActive || (user.subscriptionExpires && user.subscriptionExpires < hoje)) {
      if (user.isSubscriptionActive) {
        user.isSubscriptionActive = false;
        await user.save();
      }
      return res.status(403).json({ message: "Assinatura inativa. Ative o Match Pro." });
    }

    const matches = await Imovel.find({ comissao: { $gt: 0 }, criadoPor: { $ne: req.user.id } })
      .populate('criadoPor', 'nome email telefone creci');
    res.json(matches);
  } catch (err) {
    res.status(500).json({ message: "Erro ao carregar matches." });
  }
});

app.post('/imoveis', auth, async (req, res) => {
  try {
    const novo = new Imovel({ ...req.body, criadoPor: req.user.id });
    await novo.save();
    res.json(novo);
  } catch (err) {
    res.status(500).json({ message: "Erro ao criar anúncio." });
  }
});

app.delete('/imoveis/:id', auth, async (req, res) => {
  try {
    const imovel = await Imovel.findById(req.params.id);
    if (!imovel) return res.status(404).json({ message: "Imóvel não encontrado." });
    if (imovel.criadoPor.toString() !== req.user.id) return res.status(403).json({ message: "Sem permissão." });

    await Imovel.findByIdAndDelete(req.params.id);
    res.json({ message: "Apagado!" });
  } catch (err) {
    res.status(500).send(err);
  }
});

app.put('/imoveis/:id', auth, async (req, res) => {
  try {
    const imovel = await Imovel.findById(req.params.id);
    if (imovel.criadoPor.toString() !== req.user.id) return res.status(403).json({ message: "Sem permissão." });

    const atualizado = await Imovel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(atualizado);
  } catch (err) {
    res.status(500).send(err);
  }
});

app.post('/auth/subscribe', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.isSubscriptionActive = true;
    user.subscriptionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
    await user.save();
    res.json({ message: "Assinatura ativada!", user: { id: user._id, isSubscriptionActive: true } });
  } catch (err) {
    res.status(500).json({ message: "Erro ao processar assinatura." });
  }
});

const PORT = process.env.PORT || 10000; 
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});