const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // Instale: npm install bcryptjs
const jwt = require('jsonwebtoken'); // Instale: npm install jsonwebtoken
const axios = require('axios'); // Instale: npm install axios
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Conexão com MongoDB
const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.error("❌ ERRO: Variável MONGO_URI não encontrada no arquivo .env");
      return;
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ BANCO CONECTADO");
  } catch (err) {
    console.error("❌ ERRO NA CONEXÃO INICIAL DO MONGO:", err.message);
    // Tenta reconectar a cada 5 segundos se a conexão inicial falhar
    setTimeout(connectDB, 5000);
  }
};

connectDB();

// Monitoramento de eventos da conexão
mongoose.connection.on('error', err => {
  console.error("❌ ERRO DE CONEXÃO DURANTE A EXECUÇÃO:", err);
});

mongoose.connection.on('disconnected', () => {
  console.warn("⚠️ MONGO DESCONECTADO. O Mongoose tentará reconectar automaticamente...");
});

// --- MODELOS ---

// Modelo de Usuário (Lead)
const User = mongoose.model('User', new mongoose.Schema({
  nome: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  cpf: { type: String, required: true, unique: true },
  creci: { type: String }, // Registro profissional do corretor
  telefone: { type: String, required: true },
  senha: { type: String, required: true },
  isSubscriptionActive: { type: Boolean, default: false },
  subscriptionExpires: { type: Date },
  createdAt: { type: Date, default: Date.now }
}));

// Molde do Imóvel (Agora com referência ao dono)
const Imovel = mongoose.model('Imovel', new mongoose.Schema({
  titulo: String,
  preco: Number,
  localizacao: String,
  contato: String,
  imagemUrl: String,
  tipoNegocio: { type: String, enum: ['venda', 'aluguel'], default: 'venda' },
  tipoImovel: { type: String, enum: ['casa', 'apto', 'terreno'], default: 'casa' },
  anuncianteTipo: String, // 'vendedor' ou 'locador'
  comissao: Number, // Porcentagem ou valor fixo combinado
  status: { type: String, default: 'disponivel' }, // disponivel, vendido
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}));

// Modelo de Transação para Segurança Financeira
const Venda = mongoose.model('Venda', new mongoose.Schema({
  imovelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Imovel' },
  vendedorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  valorVenda: Number,
  comissaoSite: Number, // Calculado (2%)
  pago: { type: Boolean, default: false },
  dataVenda: { type: Date, default: Date.now }
}));

// --- MIDDLEWARE DE PROTEÇÃO ---
// Verifica se o token enviado é válido
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

// --- INTEGRAÇÃO GOOGLE SHEETS (LEADS) ---
const enviarParaGoogleSheets = async (dados) => {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK;
  if (!webhookUrl) {
    console.log("⚠️ GOOGLE_SHEETS_WEBHOOK não configurado no arquivo .env");
    return;
  }

  try {
    await axios.post(webhookUrl, dados);
    console.log("✅ Lead enviado com sucesso para o Google Sheets!");
  } catch (err) {
    console.error("❌ Erro ao enviar lead para o Webhook:", err.message);
  }
};

// --- ROTAS DE USUÁRIOS (AUTH) ---

// Cadastro de Leads
app.post('/auth/register', async (req, res) => {
  try {
    const { nome, email, cpf, creci, telefone, senha } = req.body;

    let user = await User.findOne({ $or: [{ email }, { cpf }] });
    if (user) return res.status(400).json({ message: "Usuário ou CPF já cadastrado." });

    const salt = await bcrypt.genSalt(10);
    const senhaHashed = await bcrypt.hash(senha, salt);

    user = new User({ nome, email, cpf, creci, telefone, senha: senhaHashed });
    await user.save();

    // Envio automático dos dados para a planilha via Webhook
    enviarParaGoogleSheets({ nome, email, cpf, telefone });

    res.json({ message: "Cadastro realizado com sucesso!" });
  } catch (err) {
    res.status(500).json({ message: "Erro ao registrar usuário." });
  }
});

// Login do Usuário
app.post('/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "E-mail ou senha inválidos." });

    const senhaValida = await bcrypt.compare(senha, user.senha);
    if (!senhaValida) return res.status(400).json({ message: "E-mail ou senha inválidos." });

    // Gera o Token
    const token = jwt.sign({ id: user._id, nome: user.nome }, process.env.JWT_SECRET || 'fallback_secret_para_dev');
    
    // Retorna os dados necessários para o frontend controlar o acesso
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

// ROTA 1: Buscar todos (Aberto para todos verem)
app.get('/imoveis', async (req, res) => {
    try {
        const imoveis = await Imovel.find().populate('criadoPor', 'nome email');
        res.json(imoveis);
    } catch (err) {
        res.status(500).json({ message: "Erro ao carregar imóveis." });
    }
});

// ROTA: Buscar Oportunidades de Match (Exclusivo para Assinantes)
app.get('/imoveis/matches', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        // Verifica se a assinatura está ativa e não expirou
        const hoje = new Date();
        if (!user.isSubscriptionActive || (user.subscriptionExpires && user.subscriptionExpires < hoje)) {
            // Se expirou, atualiza o status no banco
            if (user.isSubscriptionActive) {
                user.isSubscriptionActive = false;
                await user.save();
            }
            return res.status(403).json({ message: "Assinatura inativa ou expirada. Ative o Match Pro para acessar." });
        }

        // Busca imóveis com comissão (parceria) de outros corretores
        const matches = await Imovel.find({ comissao: { $gt: 0 }, criadoPor: { $ne: req.user.id } })
            .populate('criadoPor', 'nome email telefone creci');
        res.json(matches);
    } catch (err) {
        res.status(500).json({ message: "Erro ao carregar matches." });
    }
});

// ROTA 2: Criar novo (Protegido: Precisa estar logado)
app.post('/imoveis', auth, async (req, res) => {
    try {
        const novo = new Imovel({
            ...req.body,
            criadoPor: req.user.id // Vincula automaticamente ao usuário logado
        });
        await novo.save();
        res.json(novo);
    } catch (err) {
        res.status(500).json({ message: "Erro ao criar anúncio." });
    }
});

// ROTA 3: DELETAR (Protegido: Só o dono do anúncio pode apagar)
app.delete('/imoveis/:id', auth, async (req, res) => {
    try {
        const imovel = await Imovel.findById(req.params.id);
        if (!imovel) return res.status(404).json({ message: "Imóvel não encontrado." });

        // Verifica se quem está tentando apagar é o dono
        if (imovel.criadoPor.toString() !== req.user.id) {
            return res.status(403).json({ message: "Você não tem permissão para apagar este anúncio." });
        }

        await Imovel.findByIdAndDelete(req.params.id);
        res.json({ message: "Apagado!" });
    } catch (err) {
        res.status(500).send(err);
    }
});

// ROTA 4: ATUALIZAR (Protegido: Só o dono do anúncio pode editar)
app.put('/imoveis/:id', auth, async (req, res) => {
    try {
        const imovel = await Imovel.findById(req.params.id);
        if (imovel.criadoPor.toString() !== req.user.id) {
            return res.status(403).json({ message: "Sem permissão para editar." });
        }

        const atualizado = await Imovel.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(atualizado);
    } catch (err) {
        res.status(500).send(err);
    }
});

// ROTA 5: REGISTRAR VENDA (O "Caminho de Segurança")
app.post('/imoveis/:id/vender', auth, async (req, res) => {
    try {
        const imovel = await Imovel.findById(req.params.id);
        if (!imovel || imovel.criadoPor.toString() !== req.user.id) {
            return res.status(403).json({ message: "Operação não permitida." });
        }

        // Calcula os 2%
        const valorComissao = imovel.preco * 0.02;

        const novaVenda = new Venda({
            imovelId: imovel._id,
            vendedorId: req.user.id,
            valorVenda: imovel.preco,
            comissaoSite: valorComissao
        });

        await novaVenda.save();
        
        // Atualiza status do imóvel
        imovel.status = 'vendido';
        await imovel.save();

        res.json({ message: "Venda registrada! Comissão de R$" + valorComissao + " pendente.", venda: novaVenda });
    } catch (err) {
        res.status(500).json({ message: "Erro ao registrar venda." });
    }
});

// ROTA 6: Simular Assinatura (Pagamento)
app.post('/auth/subscribe', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        user.isSubscriptionActive = true;
        user.subscriptionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Ativa por 30 dias
        await user.save();

        res.json({ message: "Assinatura ativada!", user: { id: user._id, nome: user.nome, isSubscriptionActive: true } });
    } catch (err) {
        res.status(500).json({ message: "Erro ao processar assinatura." });
    }
});

const PORT = process.env.PORT || 10000; 

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});