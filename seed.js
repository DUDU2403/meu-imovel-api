const mongoose = require('mongoose');
require('dotenv').config();

// O link do banco vem do seu .env
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ Conectado para inserir dados...");
    
    // Definir o modelo (igual ao do server.js)
    const Imovel = mongoose.model('Imovel', new mongoose.Schema({
        titulo: String,
        preco: Number,
        localizacao: String,
        contato: String,
        imagemUrl: String
    }));

    // Criar o primeiro imóvel de teste
    const testeImovel = new Imovel({
        titulo: "Casa de Luxo com Piscina",
        preco: 750000,
        localizacao: "Bairro Nobre, São Paulo",
        contato: "5511999999999", // Seu WhatsApp aqui
        imagemUrl: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&q=80&w=800"
    });

    await testeImovel.save();
    console.log("🏠 IMÓVEL DE TESTE CRIADO COM SUCESSO!");
    process.exit(); // Fecha o script sozinho
  })
  .catch(err => console.log("❌ Erro:", err));