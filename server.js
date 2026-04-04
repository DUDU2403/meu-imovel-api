const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const app = express();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'eduardojunior3300@outlook.com';

// --- CONFIGURAÇÃO DO CORS ---
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'https://meu-imovel-app.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000'
    ];
    if (!origin || allowed.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
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
  tipoPerfil: { type: String, enum: ['corretor', 'proprietario', 'comprador'], default: 'comprador' },
  cidade: { type: String },
  imobiliaria: { type: String },
  experiencia: { type: String },
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
  descricao: String,
  area: Number,
  quartos: Number,
  banheiros: Number,
  vagas: Number,
  tipoNegocio: { type: String, enum: ['venda', 'aluguel'], default: 'venda' },
  tipoImovel: { type: String, enum: ['casa', 'apto', 'terreno', 'comercial', 'rural'], default: 'casa' },
  anuncianteTipo: String,
  comissao: Number,
  status: { type: String, default: 'disponivel' },
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  criadoEm: { type: Date, default: Date.now }
}));

const Venda = mongoose.model('Venda', new mongoose.Schema({
  imovelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Imovel' },
  vendedorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  valorVenda: Number,
  comissaoSite: Number,
  pago: { type: Boolean, default: false },
  dataVenda: { type: Date, default: Date.now }
}));

// --- MIDDLEWARES ---

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

const adminAuth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: "Acesso negado." });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_para_dev');
    if (decoded.email !== ADMIN_EMAIL) {
      return res.status(403).json({ message: "Acesso restrito ao administrador." });
    }
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
    console.log("✅ Lead enviado para o Google Sheets!");
  } catch (error) {
    console.error("❌ Erro ao enviar lead:", error.message);
  }
};

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/auth/register', async (req, res) => {
  try {
    const { nome, email, cpf, creci, telefone, senha, tipoPerfil, cidade, imobiliaria, experiencia } = req.body;

    if (!nome || !email || !cpf || !telefone || !senha) {
      return res.status(400).json({ message: "Preencha todos os campos obrigatórios." });
    }

    const userExistente = await User.findOne({ $or: [{ email }, { cpf }] });
    if (userExistente) return res.status(400).json({ message: "Usuário ou CPF já cadastrado." });

    const salt = await bcrypt.genSalt(10);
    const senhaHashed = await bcrypt.hash(senha, salt);

    const user = new User({ nome, email, cpf, creci, telefone, senha: senhaHashed, tipoPerfil, cidade, imobiliaria, experiencia });
    await user.save();

    enviarParaGoogleSheets({ nome, email, cpf, telefone, tipoPerfil, cidade });
    res.json({ message: "Cadastro realizado com sucesso!" });
  } catch (error) {
    res.status(500).json({ message: "Erro interno: " + error.message });
  }
});

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

    const token = jwt.sign(
      { id: user._id, nome: user.nome, email: user.email },
      process.env.JWT_SECRET || 'fallback_secret_para_dev',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        nome: user.nome,
        email: user.email,
        isAdmin: user.email === ADMIN_EMAIL,
        isSubscriptionActive: user.isSubscriptionActive,
        subscriptionExpires: user.subscriptionExpires,
        tipoPerfil: user.tipoPerfil
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Erro ao fazer login." });
  }
});

app.post('/auth/subscribe', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

    user.isSubscriptionActive = true;
    user.subscriptionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await user.save();

    res.json({ message: "Assinatura ativada!", user: { id: user._id, isSubscriptionActive: true } });
  } catch (error) {
    res.status(500).json({ message: "Erro ao processar assinatura." });
  }
});

// --- ROTAS ADMIN ---

app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const totalUsuarios = await User.countDocuments();
    const totalAssinantes = await User.countDocuments({ isSubscriptionActive: true });
    const totalImoveis = await Imovel.countDocuments();
    const totalCorretores = await User.countDocuments({ tipoPerfil: 'corretor' });
    const totalProprietarios = await User.countDocuments({ tipoPerfil: 'proprietario' });
    const totalCompradores = await User.countDocuments({ tipoPerfil: 'comprador' });
    const receitaMensal = totalAssinantes * 29.90;

    res.json({ totalUsuarios, totalAssinantes, totalImoveis, totalCorretores, totalProprietarios, totalCompradores, receitaMensal });
  } catch (error) {
    res.status(500).json({ message: "Erro ao carregar estatísticas." });
  }
});

app.get('/admin/usuarios', adminAuth, async (req, res) => {
  try {
    const usuarios = await User.find({}, '-senha').sort({ createdAt: -1 });
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ message: "Erro ao carregar usuários." });
  }
});

app.delete('/admin/usuarios/:id', adminAuth, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Usuário removido." });
  } catch (error) {
    res.status(500).json({ message: "Erro ao remover usuário." });
  }
});

app.put('/admin/usuarios/:id/assinatura', adminAuth, async (req, res) => {
  try {
    const { ativa } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

    user.isSubscriptionActive = ativa;
    user.subscriptionExpires = ativa ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
    await user.save();

    res.json({ message: `Assinatura ${ativa ? 'ativada' : 'desativada'} com sucesso.` });
  } catch (error) {
    res.status(500).json({ message: "Erro ao atualizar assinatura." });
  }
});

// --- ROTAS DE IMÓVEIS ---

app.get('/imoveis', async (req, res) => {
  try {
    const imoveis = await Imovel.find().populate('criadoPor', 'nome email');
    res.json(imoveis);
  } catch (error) {
    res.status(500).json({ message: "Erro ao carregar imóveis." });
  }
});

app.get('/imoveis/matches', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

    const hoje = new Date();
    const assinaturaExpirada = user.subscriptionExpires && user.subscriptionExpires < hoje;

    if (!user.isSubscriptionActive || assinaturaExpirada) {
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

app.post('/imoveis', auth, async (req, res) => {
  try {
    const novo = new Imovel({ ...req.body, criadoPor: req.user.id });
    await novo.save();
    res.json(novo);
  } catch (error) {
    res.status(500).json({ message: "Erro ao criar anúncio." });
  }
});

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