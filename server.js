const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Configuração do Socket.io otimizada para o Render e Expo Go
const io = new Server(server, {
  cors: {
    origin: "*", // Permite conexões de qualquer app Expo Go
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,  // Mantém a conexão aberta por mais tempo se o 4G oscilar
  pingInterval: 25000  // Envia um sinal aos celulares a cada 25s para evitar desconexão
});

// O Render exige a leitura da porta dinâmica do sistema através de process.env.PORT
const PORT = process.env.PORT || 3000;

// Rota inicial padrão (útil para testar no navegador se o servidor está online)
app.get('/', (req, res) => {
  res.send('📡 Servidor do Radar Geográfico está ONLINE e pronto!');
});

// Gerenciamento de conexões em tempo real via WebSockets
io.on('connection', (socket) => {
  console.log(`📡 [CONEXÃO] Novo smartphone conectado: ${socket.id}`);

  /**
   * 1. EVENTO: RECEBER E RETRANSMITIR DISPARO
   * Ouve quando um usupario emite um sinal com sua mensagem, posição e ângulo.
   */
  socket.on('disparar', (dadosDoDisparo) => {
    console.log(`\n🎯 [DISPARO] Enviado por: ${dadosDoDisparo.remetenteId}`);
    console.log(`   📝 Mensagem: "${dadosDoDisparo.texto}"`);
    console.log(`   📍 Coordenadas: [Lat: ${dadosDoDisparo.lat}, Lon: ${dadosDoDisparo.lon}]`);
    console.log(`   🧭 Direção da Mira: ${dadosDoDisparo.anguloDirecao}°`);

    // Retransmite para TODOS os outros usuários calcularem o impacto
    socket.broadcast.emit('mensagem_disparada', dadosDoDisparo);
  });

  /**
   * 2. EVENTO: CONFIRMAÇÃO DE RECEBIMENTO
   * Ouve quando o celular do "alvo" calcula que foi atingido e avisa o servidor.
   */
  socket.on('confirmar_recebimento', (dadosConfirmacao) => {
    console.log(`\n📈 [ENTREGA] ${dadosConfirmacao.receptorId} confirmou recebimento de ${dadosConfirmacao.remetenteId}`);
    
    // Envia o aviso de volta para a rede. O remetente vai ler isso e disparar o push de sucesso.
    io.emit('notificacao_recebida_remetente', dadosConfirmacao);
  });

  /**
   * 3. EVENTO: DESCONEXÃO
   * Monitora se o usuário fechou o app ou perdeu o sinal de internet.
   */
  socket.on('disconnect', (reason) => {
    console.log(`❌ [DESCONEXÃO] Smartphone desconectado (${socket.id}). Motivo: ${reason}`);
  });
});

// Inicialização do servidor escutando em todas as interfaces de rede (0.0.0.0)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 SERVIDOR COMPLETO PRONTO PARA O RENDER.COM!`);
  console.log(`📡 Escutando na porta: ${PORT}`);
  console.log(`====================================================`);
});
