const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const app = express();

// --- CONFIGURAÇÃO DO CORS ---
app.use(cors({
  origin: [
    'https://meu-imovel-app.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
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
  } catch (error) {
    console.error("❌ ERRO NA CONEXÃO INICIAL DO MONGO:", error.message);
    setTimeout(connectDB, 5000);
  }
}

connectDB();

mongoose.connection.on('error', (error) => {
  console.error("❌ ERRO DE CONEXÃO DURANTE A EXECUÇÃO:", error);
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

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const auth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: "Acesso negado. Faça login." });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_para_dev');
    req.user = decoded;
    next();
  } catch (error) {
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
  } catch (error) {
    console.error("❌ Erro ao enviar lead para o Webhook:", error.message);
  }
};

// --- ROTAS DE AUTENTICAÇÃO ---

// Registro
app.post('/auth/register', async (req, res) => {
  try {
    const { nome, email, cpf, creci, telefone, senha } = req.body;

    // Validação básica dos campos obrigatórios
    if (!nome || !email || !cpf || !telefone || !senha) {
      return res.status(400).json({ message: "Preencha todos os campos obrigatórios." });
    }

    const userExistente = await User.findOne({ $or: [{ email }, { cpf }] });
    if (userExistente) return res.status(400).json({ message: "Usuário ou CPF já cadastrado." });

    const salt = await bcrypt.genSalt(10);
    const senhaHashed = await bcrypt.hash(senha, salt);

    const user = new User({ nome, email, cpf, creci, telefone, senha: senhaHashed });
    await user.save();

    enviarParaGoogleSheets({ nome, email, cpf, telefone });
    res.json({ message: "Cadastro realizado com sucesso!" });
  } catch (error) {
    res.status(500).json({ message: "Erro interno: " + error.message });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ message: "E-mail e senha são obrigatórios." });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "E-mail ou senha inválidos." });

    const senhaValida = await bcrypt.compare(senha, user.senha);
    if (!senhaValida) return res.status(400).json({ message: "E-mail ou senha inválidos." });

    // Token com expiração de 7 dias
    const token = jwt.sign(
      { id: user._id, nome: user.nome },
      process.env.JWT_SECRET || 'fallback_secret_para_dev',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        nome: user.nome,
        isSubscriptionActive: user.isSubscriptionActive,
        subscriptionExpires: user.subscriptionExpires
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Erro ao fazer login." });
  }
});

// Ativar assinatura (protegida por auth)
app.post('/auth/subscribe', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

    user.isSubscriptionActive = true;
    user.subscriptionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias
    await user.save();

    res.json({ message: "Assinatura ativada!", user: { id: user._id, isSubscriptionActive: true } });
  } catch (error) {
    res.status(500).json({ message: "Erro ao processar assinatura." });
  }
});

// --- ROTAS DE IMÓVEIS ---

// Listar todos
app.get('/imoveis', async (req, res) => {
  try {
    const imoveis = await Imovel.find().populate('criadoPor', 'nome email');
    res.json(imoveis);
  } catch (error) {
    res.status(500).json({ message: "Erro ao carregar imóveis." });
  }
});

// Matches (requer assinatura ativa)
app.get('/imoveis/matches', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

    const hoje = new Date();
    const assinaturaExpirada = user.subscriptionExpires && user.subscriptionExpires < hoje;

    if (!user.isSubscriptionActive || assinaturaExpirada) {
      // Atualiza status se expirou
      if (user.isSubscriptionActive && assinaturaExpirada) {
        user.isSubscriptionActive = false;
        await user.save();
      }
      return res.status(403).json({ message: "Assinatura inativa. Ative o Match Pro." });
    }

    const matches = await Imovel.find({
      comissao: { $gt: 0 },
      criadoPor: { $ne: req.user.id }
    }).populate('criadoPor', 'nome email telefone creci');

    res.json(matches);
  } catch (error) {
    res.status(500).json({ message: "Erro ao carregar matches." });
  }
});

// Criar imóvel
app.post('/imoveis', auth, async (req, res) => {
  try {
    const novo = new Imovel({ ...req.body, criadoPor: req.user.id });
    await novo.save();
    res.json(novo);
  } catch (error) {
    res.status(500).json({ message: "Erro ao criar anúncio." });
  }
});

// Deletar imóvel
app.delete('/imoveis/:id', auth, async (req, res) => {
  try {
    const imovel = await Imovel.findById(req.params.id);
    if (!imovel) return res.status(404).json({ message: "Imóvel não encontrado." });
    if (imovel.criadoPor.toString() !== req.user.id) {
      return res.status(403).json({ message: "Sem permissão." });
    }

    await Imovel.findByIdAndDelete(req.params.id);
    res.json({ message: "Apagado!" });
  } catch (error) {
    res.status(500).json({ message: "Erro ao deletar imóvel." });
  }
});

// Editar imóvel
app.put('/imoveis/:id', auth, async (req, res) => {
  try {
    const imovel = await Imovel.findById(req.params.id);
    if (!imovel) return res.status(404).json({ message: "Imóvel não encontrado." });
    if (imovel.criadoPor.toString() !== req.user.id) {
      return res.status(403).json({ message: "Sem permissão." });
    }

    const atualizado = await Imovel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(atualizado);
  } catch (error) {
    res.status(500).json({ message: "Erro ao atualizar imóvel." });
  }
});

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});