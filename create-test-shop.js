// Script para criar uma loja de teste direto no MongoDB
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

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

const ChaveSchema = new mongoose.Schema({
  chave:    { type: String, required: true, unique: true },
  usada:    { type: Boolean, default: false },
  lojaId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Loja', default: null },
  criadaEm: { type: Date, default: Date.now },
  usadaEm:  { type: Date, default: null },
});

const Chave = mongoose.model('ChaveAcesso', ChaveSchema);

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado ao MongoDB\n');

    // Gerar uma chave de acesso
    const chaveAcesso = 'AK-' + Math.random().toString(16).substring(2, 10).toUpperCase();
    const chave = new Chave({ chave: chaveAcesso });
    await chave.save();
    console.log('✅ Chave de acesso gerada:', chaveAcesso);

    // Criar uma loja de teste
    const senhaHash = await bcrypt.hash('123456', 10);
    const loja = new Loja({
      nome: 'Loja Teste',
      email: 'teste@loja.com',
      senha: senhaHash,
      telefone: '11999999999',
      chaveAcesso: chaveAcesso,
      ativa: true,
    });
    await loja.save();
    console.log('✅ Loja de teste criada!');
    console.log('   Email: teste@loja.com');
    console.log('   Senha: 123456');
    console.log('   Chave: ' + chaveAcesso + '\n');

    // Marcar chave como usada
    await Chave.findByIdAndUpdate(chave._id, { usada: true, lojaId: loja._id, usadaEm: new Date() });
    console.log('✅ Chave marcada como usada\n');

    console.log('🎉 Tudo pronto! Você pode agora:');
    console.log('   1. Logar como vendedor com email: teste@loja.com / senha: 123456');
    console.log('   2. Registrar clientes normalmente');
    console.log('   3. Ver produtos na vitrine\n');

    await mongoose.connection.close();
  } catch (e) {
    console.error('❌ Erro:', e.message);
    process.exit(1);
  }
})();
