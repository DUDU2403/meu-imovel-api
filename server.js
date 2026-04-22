const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'eduardojunior3300@outlook.com';

// --- CORS ---
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'https://webstory-app.vercel.app',
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

// --- MONGODB ---
async function connectDB() {
  try {
    if (!process.env.MONGO_URI) {
      console.error('❌ ERRO: Variável MONGO_URI não encontrada no .env');
      return;
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ BANCO CONECTADO');
  } catch (error) {
    console.error('❌ ERRO NA CONEXÃO:', error.message);
    setTimeout(connectDB, 5000);
  }
}
connectDB();

mongoose.connection.on('error', (err) => console.error('❌ ERRO MONGO:', err));
mongoose.connection.on('disconnected', () => console.warn('⚠️ MONGO DESCONECTADO. Reconectando...'));

// --- FUNÇÕES AUXILIARES ---
const gerarChaveAcesso = () => 'AK-' + crypto.randomBytes(4).toString('hex').toUpperCase();
const gerarCodigoLoja  = () => 'LOJA-' + crypto.randomBytes(2).toString('hex').toUpperCase();

// ============================================================
// MODELS
// ============================================================

const Admin = mongoose.model('Admin', new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  senha: { type: String, required: true },
  criadoEm: { type: Date, default: Date.now }
}));

const ChaveAcesso = mongoose.model('ChaveAcesso', new mongoose.Schema({
  chave:    { type: String, required: true, unique: true },
  usada:    { type: Boolean, default: false },
  lojaId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', default: null },
  criadaEm: { type: Date, default: Date.now },
  usadaEm:  { type: Date, default: null }
}));

const Loja = mongoose.model('Loja', new mongoose.Schema({
  nome:         { type: String, required: true },
  email:        { type: String, required: true, unique: true },
  senha:        { type: String, required: true },
  telefone:     { type: String, required: true },
  codigoLoja:   { type: String, unique: true },
  chaveAcesso:  { type: String, required: true },
  cnpj:         { type: String, default: null },
  endereco:     { type: String, default: null },
  fotoPerfil:   { type: String, default: null },
  bannerFundo:  { type: String, default: null },
  ativa:        { type: Boolean, default: true },
  criadaEm:     { type: Date, default: Date.now }
}));

const Produto = mongoose.model('Produto', new mongoose.Schema({
  lojaId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true },
  nome:         { type: String, required: true },
  descricao:    { type: String, default: '' },
  preco:        { type: Number, required: true },
  precoPromo:   { type: Number, default: null },
  emPromocao:   { type: Boolean, default: false },
  imagemUrl:    { type: String, default: null },
  categoria:    { type: String, default: 'geral' },
  estoque:      { type: Number, default: 0 },
  estoqueMin:   { type: Number, default: 5 },
  ativo:        { type: Boolean, default: true },
  maisVendido:  { type: Boolean, default: false },
  criadoEm:     { type: Date, default: Date.now }
}));

const Movimentacao = mongoose.model('Movimentacao', new mongoose.Schema({
  lojaId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true },
  produtoId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Produto', required: true },
  tipo:       { type: String, enum: ['entrada', 'saida'], required: true },
  quantidade: { type: Number, required: true },
  motivo:     { type: String, default: '' },
  criadoEm:  { type: Date, default: Date.now }
}));

// ✅ Pedido com campos extras do cliente
const Pedido = mongoose.model('Pedido', new mongoose.Schema({
  lojaId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true },
  itens: [{
    produtoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Produto' },
    nome:      String,
    preco:     Number,
    quantidade: Number
  }],
  total:            { type: Number, required: true },
  nomeCliente:      { type: String, default: '' },
  telefoneCliente:  { type: String, default: '' },
  enderecoEntrega:  { type: String, default: '' },
  tipoEntrega:      { type: String, enum: ['entrega', 'retirada'], default: 'entrega' },
  observacao:       { type: String, default: '' },
  status:           { type: String, enum: ['pendente', 'confirmado', 'cancelado'], default: 'pendente' },
  criadoEm:        { type: Date, default: Date.now }
}));

// ============================================================
// MIDDLEWARES
// ============================================================

const adminAuth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: 'Acesso negado.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    if (decoded.email !== ADMIN_EMAIL) {
      return res.status(403).json({ message: 'Acesso restrito ao administrador.' });
    }
    req.admin = decoded;
    next();
  } catch {
    res.status(400).json({ message: 'Token inválido.' });
  }
};

const lojaAuth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: 'Acesso negado. Faça login.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    req.loja = decoded;
    next();
  } catch {
    res.status(400).json({ message: 'Token inválido.' });
  }
};

// ============================================================
// ROTAS: ADMIN — autenticação
// ============================================================

app.post('/admin/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (email !== ADMIN_EMAIL) return res.status(403).json({ message: 'Acesso negado.' });

    let admin = await Admin.findOne({ email });

    if (!admin) {
      if (!senha) return res.status(400).json({ message: 'Defina uma senha no primeiro acesso.' });
      const hash = await bcrypt.hash(senha, 10);
      admin = await new Admin({ email, senha: hash }).save();
    } else {
      const ok = await bcrypt.compare(senha, admin.senha);
      if (!ok) return res.status(400).json({ message: 'Senha incorreta.' });
    }

    const token = jwt.sign(
      { id: admin._id, email: admin.email },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.json({ token, email: admin.email });
  } catch (error) {
    res.status(500).json({ message: 'Erro no login: ' + error.message });
  }
});

// ============================================================
// ROTAS: ADMIN — chaves de acesso
// ============================================================

app.post('/admin/chaves', adminAuth, async (req, res) => {
  try {
    const chave = gerarChaveAcesso();
    const nova = await new ChaveAcesso({ chave }).save();
    res.json({ message: 'Chave gerada!', chave: nova.chave, id: nova._id });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar chave.' });
  }
});

app.get('/admin/chaves', adminAuth, async (req, res) => {
  try {
    const chaves = await ChaveAcesso.find().populate('lojaId', 'nome email').sort({ criadaEm: -1 });
    res.json(chaves);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar chaves.' });
  }
});

app.delete('/admin/chaves/:id', adminAuth, async (req, res) => {
  try {
    const chave = await ChaveAcesso.findById(req.params.id);
    if (!chave) return res.status(404).json({ message: 'Chave não encontrada.' });
    if (chave.usada) return res.status(400).json({ message: 'Chave já utilizada.' });
    await ChaveAcesso.findByIdAndDelete(req.params.id);
    res.json({ message: 'Chave removida.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover chave.' });
  }
});

// ============================================================
// ROTAS: ADMIN — lojas
// ============================================================

app.get('/admin/lojas', adminAuth, async (req, res) => {
  try {
    const lojas = await Loja.find({}, '-senha').sort({ criadaEm: -1 });
    res.json(lojas);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar lojas.' });
  }
});

app.put('/admin/lojas/:id/status', adminAuth, async (req, res) => {
  try {
    const { ativa } = req.body;
    const loja = await Loja.findByIdAndUpdate(req.params.id, { ativa }, { new: true, select: '-senha' });
    if (!loja) return res.status(404).json({ message: 'Loja não encontrada.' });
    res.json({ message: `Loja ${ativa ? 'ativada' : 'desativada'}.`, loja });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar status.' });
  }
});

app.delete('/admin/lojas/:id', adminAuth, async (req, res) => {
  try {
    await Loja.findByIdAndDelete(req.params.id);
    res.json({ message: 'Loja removida.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover loja.' });
  }
});

app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const totalLojas      = await Loja.countDocuments();
    const lojasAtivas     = await Loja.countDocuments({ ativa: true });
    const totalProdutos   = await Produto.countDocuments();
    const totalPedidos    = await Pedido.countDocuments();
    const chavesPendentes = await ChaveAcesso.countDocuments({ usada: false });
    res.json({ totalLojas, lojasAtivas, totalProdutos, totalPedidos, chavesPendentes });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao carregar stats.' });
  }
});

// ============================================================
// ROTAS: LOJA — cadastro e login
// ============================================================

app.post('/loja/register', async (req, res) => {
  try {
    const { nome, email, senha, telefone, chaveAcesso, cnpj, endereco } = req.body;

    if (!nome || !email || !senha || !telefone || !chaveAcesso) {
      return res.status(400).json({ message: 'Preencha todos os campos obrigatórios.' });
    }

    const chave = await ChaveAcesso.findOne({ chave: chaveAcesso });
    if (!chave)       return res.status(400).json({ message: 'Chave de acesso inválida.' });
    if (chave.usada)  return res.status(400).json({ message: 'Esta chave já foi utilizada.' });

    const existe = await Loja.findOne({ email });
    if (existe) return res.status(400).json({ message: 'E-mail já cadastrado.' });

    const senhaHash  = await bcrypt.hash(senha, 10);
    const codigoLoja = gerarCodigoLoja();

    const loja = await new Loja({
      nome, email, senha: senhaHash, telefone,
      chaveAcesso, codigoLoja,
      cnpj: cnpj || null,
      endereco: endereco || null
    }).save();

    chave.usada   = true;
    chave.lojaId  = loja._id;
    chave.usadaEm = new Date();
    await chave.save();

    res.json({ message: 'Loja cadastrada com sucesso!', codigoLoja: loja.codigoLoja });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao cadastrar: ' + error.message });
  }
});

app.post('/loja/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ message: 'E-mail e senha obrigatórios.' });

    const loja = await Loja.findOne({ email });
    if (!loja) return res.status(400).json({ message: 'E-mail ou senha inválidos.' });
    if (!loja.ativa) return res.status(403).json({ message: 'Loja desativada. Contate o suporte.' });

    const ok = await bcrypt.compare(senha, loja.senha);
    if (!ok) return res.status(400).json({ message: 'E-mail ou senha inválidos.' });

    const token = jwt.sign(
      { id: loja._id, nome: loja.nome, email: loja.email, codigoLoja: loja.codigoLoja },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      loja: {
        id: loja._id,
        nome: loja.nome,
        email: loja.email,
        codigoLoja: loja.codigoLoja,
        telefone: loja.telefone,
        fotoPerfil: loja.fotoPerfil,
        bannerFundo: loja.bannerFundo,
        isAdmin: loja.email === ADMIN_EMAIL
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao fazer login.' });
  }
});

app.put('/loja/perfil', lojaAuth, async (req, res) => {
  try {
    const { nome, telefone, endereco, fotoPerfil, bannerFundo } = req.body;
    const loja = await Loja.findByIdAndUpdate(
      req.loja.id,
      { nome, telefone, endereco, fotoPerfil, bannerFundo },
      { new: true, select: '-senha' }
    );
    res.json(loja);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar perfil.' });
  }
});

// ============================================================
// ROTA PÚBLICA — cliente acessa loja pelo código
// ============================================================

app.get('/loja/:codigoLoja', async (req, res) => {
  try {
    const loja = await Loja.findOne(
      { codigoLoja: req.params.codigoLoja.toUpperCase(), ativa: true },
      '-senha -chaveAcesso -email -cnpj'
    );
    if (!loja) return res.status(404).json({ message: 'Loja não encontrada ou inativa.' });
    res.json(loja);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar loja.' });
  }
});

// ============================================================
// ROTAS: PRODUTOS
// ============================================================

app.get('/loja/:codigoLoja/produtos', async (req, res) => {
  try {
    const loja = await Loja.findOne({ codigoLoja: req.params.codigoLoja.toUpperCase(), ativa: true });
    if (!loja) return res.status(404).json({ message: 'Loja não encontrada.' });

    const { busca, categoria, promocao } = req.query;
    const filtro = { lojaId: loja._id, ativo: true };

    if (busca)    filtro.nome      = { $regex: busca, $options: 'i' };
    if (categoria) filtro.categoria = categoria;
    if (promocao === 'true') filtro.emPromocao = true;

    const produtos = await Produto.find(filtro).sort({ maisVendido: -1, criadoEm: -1 });
    res.json(produtos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar produtos.' });
  }
});

app.post('/produtos', lojaAuth, async (req, res) => {
  try {
    const { nome, descricao, preco, precoPromo, emPromocao, imagemUrl, categoria, estoque, estoqueMin } = req.body;
    if (!nome || !preco) return res.status(400).json({ message: 'Nome e preço são obrigatórios.' });

    const produto = await new Produto({
      lojaId: req.loja.id,
      nome, descricao, preco,
      precoPromo: precoPromo || null,
      emPromocao: emPromocao || false,
      imagemUrl: imagemUrl || null,
      categoria: categoria || 'geral',
      estoque: estoque || 0,
      estoqueMin: estoqueMin || 5
    }).save();

    res.json(produto);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao cadastrar produto.' });
  }
});

app.put('/produtos/:id', lojaAuth, async (req, res) => {
  try {
    const produto = await Produto.findById(req.params.id);
    if (!produto) return res.status(404).json({ message: 'Produto não encontrado.' });
    if (produto.lojaId.toString() !== req.loja.id) return res.status(403).json({ message: 'Sem permissão.' });

    const atualizado = await Produto.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(atualizado);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao editar produto.' });
  }
});

app.delete('/produtos/:id', lojaAuth, async (req, res) => {
  try {
    const produto = await Produto.findById(req.params.id);
    if (!produto) return res.status(404).json({ message: 'Produto não encontrado.' });
    if (produto.lojaId.toString() !== req.loja.id) return res.status(403).json({ message: 'Sem permissão.' });

    await Produto.findByIdAndDelete(req.params.id);
    res.json({ message: 'Produto removido.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao remover produto.' });
  }
});

app.get('/minha-loja/produtos', lojaAuth, async (req, res) => {
  try {
    const produtos = await Produto.find({ lojaId: req.loja.id }).sort({ criadoEm: -1 });
    res.json(produtos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar produtos.' });
  }
});

// ============================================================
// ROTAS: ESTOQUE
// ============================================================

app.post('/estoque/movimentacao', lojaAuth, async (req, res) => {
  try {
    const { produtoId, tipo, quantidade, motivo } = req.body;
    if (!produtoId || !tipo || !quantidade) {
      return res.status(400).json({ message: 'produtoId, tipo e quantidade são obrigatórios.' });
    }

    const produto = await Produto.findById(produtoId);
    if (!produto) return res.status(404).json({ message: 'Produto não encontrado.' });
    if (produto.lojaId.toString() !== req.loja.id) return res.status(403).json({ message: 'Sem permissão.' });

    if (tipo === 'entrada') {
      produto.estoque += quantidade;
    } else if (tipo === 'saida') {
      if (produto.estoque < quantidade) {
        return res.status(400).json({ message: 'Estoque insuficiente.' });
      }
      produto.estoque -= quantidade;
    }
    await produto.save();

    const mov = await new Movimentacao({
      lojaId: req.loja.id,
      produtoId,
      tipo,
      quantidade,
      motivo: motivo || ''
    }).save();

    res.json({
      movimentacao: mov,
      estoqueAtual: produto.estoque,
      alertaMinimo: produto.estoque <= produto.estoqueMin
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao registrar movimentação.' });
  }
});

app.get('/estoque/historico', lojaAuth, async (req, res) => {
  try {
    const { produtoId } = req.query;
    const filtro = { lojaId: req.loja.id };
    if (produtoId) filtro.produtoId = produtoId;

    const historico = await Movimentacao.find(filtro)
      .populate('produtoId', 'nome')
      .sort({ criadoEm: -1 })
      .limit(100);

    res.json(historico);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar histórico.' });
  }
});

app.get('/estoque/alertas', lojaAuth, async (req, res) => {
  try {
    const alertas = await Produto.find({
      lojaId: req.loja.id,
      ativo: true,
      $expr: { $lte: ['$estoque', '$estoqueMin'] }
    });
    res.json(alertas);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar alertas.' });
  }
});

// ============================================================
// ROTAS: PEDIDOS
// ============================================================

app.post('/pedidos', async (req, res) => {
  try {
    const { codigoLoja, itens, nomeCliente, telefoneCliente, enderecoEntrega, tipoEntrega, observacao } = req.body;
    if (!codigoLoja || !itens || itens.length === 0) {
      return res.status(400).json({ message: 'codigoLoja e itens são obrigatórios.' });
    }

    const loja = await Loja.findOne({ codigoLoja: codigoLoja.toUpperCase(), ativa: true });
    if (!loja) return res.status(404).json({ message: 'Loja não encontrada.' });

    let total = 0;
    let mensagemWpp = `*🛒 Novo pedido via WebStory!*\n\n`;

    if (nomeCliente)      mensagemWpp += `*👤 Cliente:* ${nomeCliente}\n`;
    if (telefoneCliente)  mensagemWpp += `*📱 Telefone:* ${telefoneCliente}\n`;
    if (tipoEntrega === 'retirada') {
      mensagemWpp += `*🏪 Tipo:* Retirar na loja\n`;
    } else {
      mensagemWpp += `*🚚 Tipo:* Entrega\n`;
      if (enderecoEntrega) mensagemWpp += `*📍 Endereço:* ${enderecoEntrega}\n`;
    }
    if (observacao) mensagemWpp += `*📝 Obs:* ${observacao}\n`;

    mensagemWpp += `\n*📦 Itens:*\n`;

    const itensFormatados = itens.map(item => {
      const subtotal = item.preco * item.quantidade;
      total += subtotal;
      mensagemWpp += `• ${item.nome} x${item.quantidade} — R$ ${subtotal.toFixed(2)}\n`;
      return { produtoId: item.produtoId, nome: item.nome, preco: item.preco, quantidade: item.quantidade };
    });

    mensagemWpp += `\n*💰 Total: R$ ${total.toFixed(2)}*\n`;
    mensagemWpp += `\n_Pagamento via Pix combinado no WhatsApp._`;

    const pedido = await new Pedido({
      lojaId: loja._id,
      itens: itensFormatados,
      total,
      nomeCliente:     nomeCliente || '',
      telefoneCliente: telefoneCliente || '',
      enderecoEntrega: enderecoEntrega || (tipoEntrega === 'retirada' ? 'RETIRADA NA LOJA' : ''),
      tipoEntrega:     tipoEntrega || 'entrega',
      observacao:      observacao || '',
    }).save();

    const telefone = loja.telefone.replace(/\D/g, '');
    const linkWhatsApp = `https://wa.me/55${telefone}?text=${encodeURIComponent(mensagemWpp)}`;

    res.json({ pedidoId: pedido._id, total, linkWhatsApp });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar pedido: ' + error.message });
  }
});

app.get('/minha-loja/pedidos', lojaAuth, async (req, res) => {
  try {
    const pedidos = await Pedido.find({ lojaId: req.loja.id }).sort({ criadoEm: -1 });
    res.json(pedidos);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao listar pedidos.' });
  }
});

app.put('/pedidos/:id/status', lojaAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const pedido = await Pedido.findById(req.params.id);
    if (!pedido) return res.status(404).json({ message: 'Pedido não encontrado.' });
    if (pedido.lojaId.toString() !== req.loja.id) return res.status(403).json({ message: 'Sem permissão.' });

    pedido.status = status;
    await pedido.save();
    res.json(pedido);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar pedido.' });
  }
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 WebStory rodando na porta ${PORT}`);
});