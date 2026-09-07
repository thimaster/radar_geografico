const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Configuração do Socket.io otimizada para o Render e Expo Go
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,  
  pingInterval: 25000  
});

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('📡 Servidor do Radar Geográfico está ONLINE e pronto!');
});

// Gerenciamento de conexões em tempo real via WebSockets
io.on('connection', (socket) => {
  console.log(`📡 [SISTEMA] Novo smartphone conectado (ID do Socket: ${socket.id})`);

  /**
   * 1. LOG DE DISPARO (Quem envia)
   * Ouve quando um aluno emite um sinal com sua mensagem, posição e ângulo.
   */
  socket.on('disparar', (dadosDoDisparo) => {
    // === LOG DE DISPARO EM TELA ===
    console.log(`\n╔══════════════════════════════════════════════════`);
    console.log(`║ 🚀 [MENSAGEM DISPARADA]`);
    console.log(`║ 👤 Remetente (meuId): ${dadosDoDisparo.remetenteId}`);
    console.log(`║ 📍 Posição: [Lat: ${dadosDoDisparo.lat}, Lon: ${dadosDoDisparo.lon}]`);
    console.log(`║ 🧭 Direção da Mira: ${dadosDoDisparo.anguloDirecao}°`);
    console.log(`╚══════════════════════════════════════════════════`);

    // Retransmite para TODOS os outros usuários
    socket.broadcast.emit('mensagem_disparada', dadosDoDisparo);
  });

  /**
   * 2. LOG DE RECEBIMENTO (Quem recebe)
   * Ouve quando o celular do "alvo" calcula que foi atingido e avisa o servidor.
   */
  socket.on('confirmar_recebimento', (dadosConfirmacao) => {
    // === LOG DE RECEBIMENTO EM TELA ===
    console.log(`\n╔══════════════════════════════════════════════════`);
    console.log(`║ 🎯 [MENSAGEM ENTREGUE NO ALVO!]`);
    console.log(`║ 👤 Receptor/Alvo (meuId): ${dadosConfirmacao.receptorId}`);
    console.log(`║ 👤 Enviada originalmente por: ${dadosConfirmacao.remetenteId}`);
    console.log(`║ 🆔 ID do Disparo: ${dadosConfirmacao.idDisparo}`);
    console.log(`╚══════════════════════════════════════════════════`);
    
    // Envia o aviso de volta para a rede. O remetente vai ler isso e disparar o push de sucesso.
    io.emit('notificacao_recebida_remetente', dadosConfirmacao);
  });

  socket.on('disconnect', (reason) => {
    console.log(`❌ [SISTEMA] Smartphone desconectado. Motivo: ${reason}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 SERVIDOR COM LOGS POR "meuId" PRONTO!`);
  console.log(`📡 Escutando na porta: ${PORT}`);
  console.log(`====================================================`);
});
