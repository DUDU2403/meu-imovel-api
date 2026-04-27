// Script para diagnosticar problemas de login
const axios = require('axios');

const BASE_URL = 'http://localhost:10000';

(async () => {
  try {
    console.log('\n=== DIAGNÓSTICO DE LOGIN ===\n');

    // 1. Testar se servidor está respondendo
    console.log('1️⃣ Testando conexão com servidor...');
    try {
      const health = await axios.get(`${BASE_URL}/produtos`);
      console.log('✅ Servidor respondendo');
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        console.log('❌ Servidor não está rodando');
        return;
      }
    }

    // 2. Testar se há lojas no banco
    console.log('\n2️⃣ Procurando lojas no banco...');
    try {
      const res = await axios.get(`${BASE_URL}/produtos`);
      console.log('✅ Banco está respondendo, há', res.data?.length || 0, 'produtos');
    } catch (e) {
      console.log('❌ Erro ao conectar com o banco:', e.response?.data?.message);
      return;
    }

    // 3. Testar login com email/senha de teste
    console.log('\n3️⃣ Testando login de vendedor...');
    console.log('   Email: teste@loja.com (mude se necessário)');
    console.log('   Senha: 123456 (mude se necessário)');
    
    try {
      const loginRes = await axios.post(`${BASE_URL}/loja/login`, {
        email: 'teste@loja.com',
        senha: '123456'
      });
      console.log('✅ Login bem-sucedido!');
      console.log('   Token:', loginRes.data.token.substring(0, 50) + '...');
      console.log('   Perfil:', loginRes.data.perfil?.nome);
    } catch (e) {
      if (e.response?.status === 400) {
        console.log('❌ Erro: ' + e.response.data.message);
        console.log('   → Possível causa: Email/senha incorretos ou loja não existe');
      } else if (e.response?.status === 403) {
        console.log('❌ Erro: ' + e.response.data.message);
        console.log('   → Possível causa: Loja está desativada');
      } else {
        console.log('❌ Erro:', e.response?.data?.message || e.message);
      }
    }

    // 4. Testar registro de cliente
    console.log('\n4️⃣ Testando registro de cliente...');
    try {
      const registerRes = await axios.post(`${BASE_URL}/clientes/register`, {
        nome: 'Cliente Teste',
        username: 'clienteteste' + Date.now(),
        email: 'cliente' + Date.now() + '@teste.com',
        senha: '123456',
        telefone: '11999999999'
      });
      console.log('✅ Registro de cliente bem-sucedido!');
      console.log('   Token:', registerRes.data.token.substring(0, 50) + '...');
    } catch (e) {
      console.log('❌ Erro:', e.response?.data?.message || e.message);
    }

    console.log('\n=== FIM DO DIAGNÓSTICO ===\n');
  } catch (e) {
    console.error('Erro geral:', e.message);
  }
})();
