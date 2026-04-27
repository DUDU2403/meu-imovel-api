const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
require('dotenv').config();

const app = express();
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  || 'admin@webstory.com';
const JWT_SECRET   = process.env.JWT_SECRET   || 'fallback_secret_change_me';

// ── CORS ─────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.endsWith('.vercel.app') || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-auth-token'],
  credentials: true,
}));
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin',  req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-auth-token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204);
});
app.use(express.json());

// ── DB ───────────────────────────────────────────────────────
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ BANCO CONECTADO');
  } catch (err) {
    console.error('❌ ERRO DB:', err.message);
    setTimeout(connectDB, 5000);
  }
}
connectDB();
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ Desconectado. Reconectando...');
  setTimeout(connectDB, 3000);
});

// ── HELPERS ──────────────────────────────────────────────────
const gerarChave = () => 'AK-' + crypto.randomBytes(4).toString('hex').toUpperCase();

// ============================================================
// MODELS
// ============================================================

// Admin do sistema (você)
const AdminSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true },
  senha:    { type: String, required: true },
  criadoEm:{ type: Date, default: Date.now },
});
const Admin = mongoose.model('Admin', AdminSchema);

// Chave de acesso para ativar uma loja
const ChaveSchema = new mongoose.Schema({
  chave:    { type: String, required: true, unique: true },
  usada:    { type: Boolean, default: false },
  lojaId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', default: null },
  criadaEm: { type: Date, default: Date.now },
  usadaEm:  { type: Date, default: null },
});
const Chave = mongoose.model('ChaveAcesso', ChaveSchema);

// Loja (dono)
const LojaSchema = new mongoose.Schema({
  nome:        { type: String, required: true },
  email:       { type: String, required: true, unique: true },
  senha:       { type: String, required: true },
  telefone:    { type: String, required: true },
  chaveAcesso: { type: String, required: true },
  cnpj:        { type: String, default: null },
  endereco:    { type: String, default: null },
  fotoPerfil:  { type: String, default: null },
  bannerFundo: { type: String, default: null },
  ativa:       { type: Boolean, default: true },
  criadaEm:   { type: Date, default: Date.now },
});
const Loja = mongoose.model('Loja', LojaSchema);

// Funcionário (acesso ao painel, mas não gerencia outros funcionários)
const FuncionarioSchema = new mongoose.Schema({
  lojaId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true },
  nome:     { type: String, required: true },
  email:    { type: String, required: true },
  senha:    { type: String, required: true },
  ativo:    { type: Boolean, default: true },
  criadoEm: { type: Date, default: Date.now },
});
const Funcionario = mongoose.model('Funcionario', FuncionarioSchema);

// Cliente (comprador)
const ClienteSchema = new mongoose.Schema({
  lojaId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true },
  nome:      { type: String, required: true },
  username:  { type: String, required: true },
  email:     { type: String, required: true },
  senha:     { type: String, required: true },
  telefone:  { type: String, required: true },
  endereco:  { type: String, default: '' },
  ativo:     { type: Boolean, default: true },
  criadoEm: { type: Date, default: Date.now },
});
// email único por loja
ClienteSchema.index({ lojaId: 1, email: 1 }, { unique: true });
ClienteSchema.index({ lojaId: 1, username: 1 }, { unique: true });
const Cliente = mongoose.model('Cliente', ClienteSchema);

// Produto
const ProdutoSchema = new mongoose.Schema({
  lojaId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true },
  nome:        { type: String, required: true },
  descricao:   { type: String, default: '' },
  preco:       { type: Number, required: true },
  precoPromo:  { type: Number, default: null },
  emPromocao:  { type: Boolean, default: false },
  imagemUrl:   { type: String, default: null },
  categoria:   { type: String, default: 'geral' },
  estoque:     { type: Number, default: 0 },
  estoqueMin:  { type: Number, default: 5 },
  ativo:       { type: Boolean, default: true },
  maisVendido: { type: Boolean, default: false },
  criadoEm:   { type: Date, default: Date.now },
});
const Produto = mongoose.model('Produto', ProdutoSchema);

// Movimentação de estoque
const MovSchema = new mongoose.Schema({
  lojaId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true },
  produtoId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Produto', required: true },
  tipo:       { type: String, enum: ['entrada','saida'], required: true },
  quantidade: { type: Number, required: true },
  motivo:     { type: String, default: '' },
  operador:   { type: String, default: 'sistema' }, // nome de quem fez
  criadoEm:  { type: Date, default: Date.now },
});
const Movimentacao = mongoose.model('Movimentacao', MovSchema);

// Pedido online (cliente finaliza carrinho → WhatsApp)
const PedidoSchema = new mongoose.Schema({
  lojaId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true },
  clienteId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', default: null },
  itens: [{
    produtoId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Produto' },
    nome:       String,
    preco:      Number,
    quantidade: Number,
  }],
  total:           { type: Number, required: true },
  nomeCliente:     { type: String, default: '' },
  telefoneCliente: { type: String, default: '' },
  enderecoEntrega: { type: String, default: '' },
  tipoEntrega:     { type: String, enum: ['entrega','retirada'], default: 'entrega' },
  observacao:      { type: String, default: '' },
  status:          { type: String, enum: ['pendente','confirmado','cancelado'], default: 'pendente' },
  criadoEm:       { type: Date, default: Date.now },
});
const Pedido = mongoose.model('Pedido', PedidoSchema);

// Venda Avulsa (presencial — desconta estoque direto)
const VendaAvulsaSchema = new mongoose.Schema({
  lojaId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', required: true },
  itens: [{
    produtoId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Produto' },
    nome:       String,
    preco:      Number,
    quantidade: Number,
  }],
  total:       { type: Number, required: true },
  nomeCliente: { type: String, default: 'Cliente avulso' },
  operador:    { type: String, default: '' },
  observacao:  { type: String, default: '' },
  criadoEm:   { type: Date, default: Date.now },
});
const VendaAvulsa = mongoose.model('VendaAvulsa', VendaAvulsaSchema);

// ============================================================
// MIDDLEWARES DE AUTH
// ============================================================

const adminAuth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: 'Acesso negado.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ message: 'Apenas admin.' });
    req.admin = decoded;
    next();
  } catch { res.status(400).json({ message: 'Token inválido.' }); }
};

// Loja (dono) ou Funcionário
const lojaAuth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: 'Faça login.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'loja' && decoded.role !== 'funcionario') {
      return res.status(403).json({ message: 'Acesso negado.' });
    }
    req.loja = decoded;
    next();
  } catch { res.status(400).json({ message: 'Token inválido.' }); }
};

// Apenas o dono da loja (não funcionário)
const donoAuth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: 'Faça login.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'loja') return res.status(403).json({ message: 'Apenas o dono pode fazer isso.' });
    req.loja = decoded;
    next();
  } catch { res.status(400).json({ message: 'Token inválido.' }); }
};

// Cliente logado
const clienteAuth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ message: 'Faça login.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'cliente') return res.status(403).json({ message: 'Acesso negado.' });
    req.cliente = decoded;
    next();
  } catch { res.status(400).json({ message: 'Token inválido.' }); }
};

// ============================================================
// ROTAS: ADMIN
// ============================================================

app.post('/admin/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (email !== ADMIN_EMAIL) return res.status(403).json({ message: 'Acesso negado.' });

    let admin = await Admin.findOne({ email });
    if (!admin) {
      if (!senha) return res.status(400).json({ message: 'Defina uma senha no primeiro acesso.' });
      admin = await new Admin({ email, senha: await bcrypt.hash(senha, 10) }).save();
    } else {
      if (!await bcrypt.compare(senha, admin.senha)) return res.status(400).json({ message: 'Senha incorreta.' });
    }

    const token = jwt.sign({ id: admin._id, email, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/admin/chaves', adminAuth, async (req, res) => {
  try {
    const nova = await new Chave({ chave: gerarChave() }).save();
    res.json({ chave: nova.chave, id: nova._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/admin/chaves', adminAuth, async (req, res) => {
  try {
    const chaves = await Chave.find().populate('lojaId','nome email').sort({ criadaEm: -1 });
    res.json(chaves);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/admin/chaves/:id', adminAuth, async (req, res) => {
  try {
    const c = await Chave.findById(req.params.id);
    if (!c) return res.status(404).json({ message: 'Chave não encontrada.' });
    await c.deleteOne();
    res.json({ message: 'Removida.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/admin/lojas', adminAuth, async (req, res) => {
  try {
    res.json(await Loja.find({}, '-senha').sort({ criadaEm: -1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/admin/lojas/:id/status', adminAuth, async (req, res) => {
  try {
    const loja = await Loja.findByIdAndUpdate(req.params.id, { ativa: req.body.ativa }, { new: true, select: '-senha' });
    res.json(loja);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/admin/lojas/:id', adminAuth, async (req, res) => {
  try {
    await Loja.findByIdAndDelete(req.params.id);
    res.json({ message: 'Removida.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/admin/stats', adminAuth, async (req, res) => {
  try {
    const [totalLojas, lojasAtivas, totalProdutos, totalPedidos, chavesPendentes] = await Promise.all([
      Loja.countDocuments(), Loja.countDocuments({ ativa: true }),
      Produto.countDocuments(), Pedido.countDocuments(),
      Chave.countDocuments({ usada: false }),
    ]);
    res.json({ totalLojas, lojasAtivas, totalProdutos, totalPedidos, chavesPendentes });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// ROTAS: LOJA (dono)
// ============================================================

app.post('/loja/register', async (req, res) => {
  try {
    const { nome, email, senha, telefone, chaveAcesso, cnpj, endereco } = req.body;
    if (!nome || !email || !senha || !telefone || !chaveAcesso)
      return res.status(400).json({ message: 'Preencha todos os campos obrigatórios.' });

    const chave = await Chave.findOne({ chave: chaveAcesso });
    if (!chave)      return res.status(400).json({ message: 'Chave inválida.' });
    if (chave.usada) return res.status(400).json({ message: 'Chave já utilizada.' });
    if (await Loja.findOne({ email })) return res.status(400).json({ message: 'E-mail já cadastrado.' });

    const loja = await new Loja({
      nome, email, senha: await bcrypt.hash(senha, 10),
      telefone, chaveAcesso, cnpj: cnpj || null, endereco: endereco || null,
    }).save();

    chave.usada = true; chave.lojaId = loja._id; chave.usadaEm = new Date();
    await chave.save();

    res.json({ message: 'Loja criada!', lojaId: loja._id });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/loja/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const loja = await Loja.findOne({ email });
    if (!loja || !await bcrypt.compare(senha, loja.senha))
      return res.status(400).json({ message: 'E-mail ou senha inválidos.' });
    if (!loja.ativa) return res.status(403).json({ message: 'Loja desativada.' });

    const token = jwt.sign(
      { id: loja._id, nome: loja.nome, email: loja.email, role: 'loja' },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, perfil: { id: loja._id, nome: loja.nome, email: loja.email, role: 'loja', telefone: loja.telefone, fotoPerfil: loja.fotoPerfil, bannerFundo: loja.bannerFundo } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/loja/perfil', donoAuth, async (req, res) => {
  try {
    const { nome, telefone, endereco, fotoPerfil, bannerFundo } = req.body;
    const loja = await Loja.findByIdAndUpdate(req.loja.id, { nome, telefone, endereco, fotoPerfil, bannerFundo }, { new: true, select: '-senha' });
    res.json(loja);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Info pública da loja (para o frontend carregar nome, banner, etc.)
app.get('/loja/info', async (req, res) => {
  try {
    const loja = await Loja.findOne({ ativa: true }, '-senha -chaveAcesso -email -cnpj').sort({ criadaEm: 1 });
    if (!loja) return res.status(404).json({ message: 'Loja não encontrada.' });
    res.json(loja);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// ROTAS: FUNCIONÁRIOS
// ============================================================

app.get('/funcionarios', donoAuth, async (req, res) => {
  try {
    res.json(await Funcionario.find({ lojaId: req.loja.id }, '-senha').sort({ criadoEm: -1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/funcionarios', donoAuth, async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ message: 'Nome, e-mail e senha obrigatórios.' });
    if (await Funcionario.findOne({ lojaId: req.loja.id, email }))
      return res.status(400).json({ message: 'E-mail já cadastrado.' });

    const func = await new Funcionario({
      lojaId: req.loja.id, nome, email,
      senha: await bcrypt.hash(senha, 10),
    }).save();
    res.json({ ...func.toObject(), senha: undefined });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/funcionarios/:id', donoAuth, async (req, res) => {
  try {
    const updates = { nome: req.body.nome, ativo: req.body.ativo };
    if (req.body.senha) updates.senha = await bcrypt.hash(req.body.senha, 10);
    const func = await Funcionario.findOneAndUpdate(
      { _id: req.params.id, lojaId: req.loja.id }, updates, { new: true, select: '-senha' }
    );
    res.json(func);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/funcionarios/:id', donoAuth, async (req, res) => {
  try {
    await Funcionario.findOneAndDelete({ _id: req.params.id, lojaId: req.loja.id });
    res.json({ message: 'Removido.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/funcionarios/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const func = await Funcionario.findOne({ email });
    if (!func || !await bcrypt.compare(senha, func.senha))
      return res.status(400).json({ message: 'E-mail ou senha inválidos.' });
    if (!func.ativo) return res.status(403).json({ message: 'Funcionário desativado.' });

    const loja = await Loja.findById(func.lojaId);
    if (!loja || !loja.ativa) return res.status(403).json({ message: 'Loja desativada.' });

    const token = jwt.sign(
      { id: func._id, lojaId: func.lojaId, nome: func.nome, email: func.email, role: 'funcionario' },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, perfil: { id: func._id, nome: func.nome, email: func.email, role: 'funcionario' } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// ROTAS: CLIENTES (compradores)
// ============================================================

app.post('/clientes/register', async (req, res) => {
  try {
    const { nome, username, email, senha, telefone, endereco } = req.body;
    if (!nome || !username || !email || !senha || !telefone)
      return res.status(400).json({ message: 'Preencha todos os campos obrigatórios.' });

    const loja = await Loja.findOne({ ativa: true }).sort({ criadaEm: 1 });
    if (!loja) return res.status(404).json({ message: 'Loja não encontrada.' });

    if (await Cliente.findOne({ lojaId: loja._id, email }))
      return res.status(400).json({ message: 'E-mail já cadastrado.' });
    if (await Cliente.findOne({ lojaId: loja._id, username }))
      return res.status(400).json({ message: 'Nome de usuário já em uso.' });

    const cliente = await new Cliente({
      lojaId: loja._id, nome, username: username.toLowerCase(),
      email, senha: await bcrypt.hash(senha, 10), telefone, endereco: endereco || '',
    }).save();

    const token = jwt.sign(
      { id: cliente._id, lojaId: loja._id, nome: cliente.nome, email: cliente.email, role: 'cliente' },
      JWT_SECRET, { expiresIn: '30d' }
    );
    res.json({ token, perfil: { id: cliente._id, nome: cliente.nome, username: cliente.username, email: cliente.email, telefone: cliente.telefone, endereco: cliente.endereco } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/clientes/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const loja = await Loja.findOne({ ativa: true }).sort({ criadaEm: 1 });
    if (!loja) return res.status(404).json({ message: 'Loja não encontrada.' });

    const cliente = await Cliente.findOne({ lojaId: loja._id, email });
    if (!cliente || !await bcrypt.compare(senha, cliente.senha))
      return res.status(400).json({ message: 'E-mail ou senha inválidos.' });
    if (!cliente.ativo) return res.status(403).json({ message: 'Conta desativada.' });

    const token = jwt.sign(
      { id: cliente._id, lojaId: loja._id, nome: cliente.nome, email: cliente.email, role: 'cliente' },
      JWT_SECRET, { expiresIn: '30d' }
    );
    res.json({ token, perfil: { id: cliente._id, nome: cliente.nome, username: cliente.username, email: cliente.email, telefone: cliente.telefone, endereco: cliente.endereco } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/clientes/perfil', clienteAuth, async (req, res) => {
  try {
    const { nome, telefone, endereco } = req.body;
    const c = await Cliente.findByIdAndUpdate(req.cliente.id, { nome, telefone, endereco }, { new: true, select: '-senha' });
    res.json(c);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Lista de clientes para o painel do vendedor
app.get('/clientes', lojaAuth, async (req, res) => {
  try {
    res.json(await Cliente.find({ lojaId: req.loja.id }, '-senha').sort({ criadoEm: -1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// ROTAS: PRODUTOS
// ============================================================

// Público — vitrine
app.get('/produtos', async (req, res) => {
  try {
    const loja = await Loja.findOne({ ativa: true }).sort({ criadaEm: 1 });
    if (!loja) return res.status(404).json({ message: 'Loja não encontrada.' });

    const { busca, categoria, promocao, ordem } = req.query;
    const filtro = { lojaId: loja._id, ativo: true };
    if (busca)     filtro.nome      = { $regex: busca, $options: 'i' };
    if (categoria) filtro.categoria = categoria;
    if (promocao === 'true') filtro.emPromocao = true;

    let query = Produto.find(filtro);
    if (ordem === 'menor')    query = query.sort({ preco: 1 });
    else if (ordem === 'maior') query = query.sort({ preco: -1 });
    else if (ordem === 'novo')  query = query.sort({ criadoEm: -1 });
    else query = query.sort({ maisVendido: -1, criadoEm: -1 });

    res.json(await query);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Sugestão para autocomplete
app.get('/produtos/sugestoes', async (req, res) => {
  try {
    const loja = await Loja.findOne({ ativa: true }).sort({ criadaEm: 1 });
    const { busca } = req.query;
    if (!busca || busca.length < 2) return res.json([]);
    const produtos = await Produto.find(
      { lojaId: loja._id, ativo: true, nome: { $regex: busca, $options: 'i' } },
      'nome categoria imagemUrl preco'
    ).limit(6);
    res.json(produtos);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Categorias disponíveis
app.get('/produtos/categorias', async (req, res) => {
  try {
    const loja = await Loja.findOne({ ativa: true }).sort({ criadaEm: 1 });
    const cats = await Produto.distinct('categoria', { lojaId: loja._id, ativo: true });
    res.json(cats.filter(Boolean));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Painel — listar produtos da loja
app.get('/painel/produtos', lojaAuth, async (req, res) => {
  try {
    res.json(await Produto.find({ lojaId: req.loja.id }).sort({ criadoEm: -1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/produtos', lojaAuth, async (req, res) => {
  try {
    const { nome, preco } = req.body;
    if (!nome || !preco) return res.status(400).json({ message: 'Nome e preço obrigatórios.' });
    const p = await new Produto({ lojaId: req.loja.id, ...req.body }).save();
    res.json(p);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/produtos/:id', lojaAuth, async (req, res) => {
  try {
    const p = await Produto.findOne({ _id: req.params.id, lojaId: req.loja.id });
    if (!p) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.json(await Produto.findByIdAndUpdate(req.params.id, req.body, { new: true }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/produtos/:id', lojaAuth, async (req, res) => {
  try {
    await Produto.findOneAndDelete({ _id: req.params.id, lojaId: req.loja.id });
    res.json({ message: 'Removido.' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// ROTAS: ESTOQUE
// ============================================================

app.post('/estoque/movimentacao', lojaAuth, async (req, res) => {
  try {
    const { produtoId, tipo, quantidade, motivo } = req.body;
    if (!produtoId || !tipo || !quantidade)
      return res.status(400).json({ message: 'Campos obrigatórios faltando.' });

    const p = await Produto.findOne({ _id: produtoId, lojaId: req.loja.id });
    if (!p) return res.status(404).json({ message: 'Produto não encontrado.' });

    if (tipo === 'entrada') p.estoque += Number(quantidade);
    else {
      if (p.estoque < quantidade) return res.status(400).json({ message: 'Estoque insuficiente.' });
      p.estoque -= Number(quantidade);
    }
    await p.save();

    const mov = await new Movimentacao({
      lojaId: req.loja.id, produtoId, tipo,
      quantidade: Number(quantidade),
      motivo: motivo || '',
      operador: req.loja.nome || '',
    }).save();

    res.json({ movimentacao: mov, estoqueAtual: p.estoque, alertaMinimo: p.estoque <= p.estoqueMin });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/estoque/historico', lojaAuth, async (req, res) => {
  try {
    const filtro = { lojaId: req.loja.id };
    if (req.query.produtoId) filtro.produtoId = req.query.produtoId;
    res.json(await Movimentacao.find(filtro).populate('produtoId','nome').sort({ criadoEm: -1 }).limit(200));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/estoque/alertas', lojaAuth, async (req, res) => {
  try {
    res.json(await Produto.find({ lojaId: req.loja.id, ativo: true, $expr: { $lte: ['$estoque','$estoqueMin'] } }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// ROTAS: PEDIDOS ONLINE
// ============================================================

app.post('/pedidos', clienteAuth, async (req, res) => {
  try {
    const { itens, tipoEntrega, enderecoEntrega, observacao } = req.body;
    if (!itens || itens.length === 0) return res.status(400).json({ message: 'Carrinho vazio.' });

    const loja = await Loja.findById(req.cliente.lojaId);
    if (!loja) return res.status(404).json({ message: 'Loja não encontrada.' });

    const cliente = await Cliente.findById(req.cliente.id);

    let total = 0;
    let msg = `*🛒 Novo pedido via ${loja.nome}!*\n\n`;
    msg += `*👤 Cliente:* ${cliente.nome}\n`;
    msg += `*📱 Telefone:* ${cliente.telefone}\n`;
    msg += `*👤 Username:* @${cliente.username}\n`;

    if (tipoEntrega === 'retirada') {
      msg += `*🏪 Tipo:* Retirar na loja\n`;
    } else {
      msg += `*🚚 Tipo:* Entrega\n`;
      msg += `*📍 Endereço:* ${enderecoEntrega || cliente.endereco}\n`;
    }
    if (observacao) msg += `*📝 Obs:* ${observacao}\n`;
    msg += `\n*📦 Itens:*\n`;

    const itensFormatados = itens.map(item => {
      const sub = item.preco * item.quantidade;
      total += sub;
      msg += `• ${item.nome} x${item.quantidade} — R$ ${sub.toFixed(2)}\n`;
      return { produtoId: item.produtoId, nome: item.nome, preco: item.preco, quantidade: item.quantidade };
    });

    msg += `\n*💰 Total: R$ ${total.toFixed(2)}*\n_Pagamento combinado no WhatsApp._`;

    const pedido = await new Pedido({
      lojaId: loja._id, clienteId: cliente._id,
      itens: itensFormatados, total,
      nomeCliente: cliente.nome, telefoneCliente: cliente.telefone,
      enderecoEntrega: tipoEntrega === 'retirada' ? 'RETIRADA NA LOJA' : (enderecoEntrega || cliente.endereco),
      tipoEntrega: tipoEntrega || 'entrega',
      observacao: observacao || '',
    }).save();

    const tel = loja.telefone.replace(/\D/g, '');
    const link = `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`;
    res.json({ pedidoId: pedido._id, total, linkWhatsApp: link });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/painel/pedidos', lojaAuth, async (req, res) => {
  try {
    res.json(await Pedido.find({ lojaId: req.loja.id }).sort({ criadoEm: -1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/pedidos/:id/status', lojaAuth, async (req, res) => {
  try {
    const p = await Pedido.findOneAndUpdate(
      { _id: req.params.id, lojaId: req.loja.id },
      { status: req.body.status }, { new: true }
    );
    res.json(p);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Pedidos do cliente logado
app.get('/meus-pedidos', clienteAuth, async (req, res) => {
  try {
    res.json(await Pedido.find({ clienteId: req.cliente.id }).sort({ criadoEm: -1 }));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// ROTAS: VENDA AVULSA (presencial)
// ============================================================

app.post('/vendas-avulsas', lojaAuth, async (req, res) => {
  try {
    const { itens, nomeCliente, observacao } = req.body;
    if (!itens || itens.length === 0) return res.status(400).json({ message: 'Sem itens.' });

    let total = 0;
    const itensFormatados = [];

    for (const item of itens) {
      const p = await Produto.findOne({ _id: item.produtoId, lojaId: req.loja.id });
      if (!p) return res.status(404).json({ message: `Produto ${item.nome} não encontrado.` });
      if (p.estoque < item.quantidade) return res.status(400).json({ message: `Estoque insuficiente: ${p.nome} (${p.estoque} disponíveis).` });

      // Desconta estoque
      p.estoque -= item.quantidade;
      await p.save();

      // Registra movimentação
      await new Movimentacao({
        lojaId: req.loja.id, produtoId: p._id,
        tipo: 'saida', quantidade: item.quantidade,
        motivo: `Venda avulsa — ${nomeCliente || 'cliente avulso'}`,
        operador: req.loja.nome || '',
      }).save();

      const sub = item.preco * item.quantidade;
      total += sub;
      itensFormatados.push({ produtoId: p._id, nome: p.nome, preco: item.preco, quantidade: item.quantidade });
    }

    const venda = await new VendaAvulsa({
      lojaId: req.loja.id,
      itens: itensFormatados, total,
      nomeCliente: nomeCliente || 'Cliente avulso',
      operador: req.loja.nome || '',
      observacao: observacao || '',
    }).save();

    res.json({ venda, total });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/vendas-avulsas', lojaAuth, async (req, res) => {
  try {
    res.json(await VendaAvulsa.find({ lojaId: req.loja.id }).sort({ criadoEm: -1 }).limit(100));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
// INICIAR
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Porta ${PORT}`));