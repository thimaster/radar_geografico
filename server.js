const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3000;
const configuredTtlMs = Number(process.env.MESSAGE_TTL_MS);
const TTL_MS = Number.isFinite(configuredTtlMs) && configuredTtlMs > 0
  ? configuredTtlMs
  : 2 * 60 * 1000;
const DEFAULT_RADIUS_METERS = 500;
const DEFAULT_TOLERANCE_DEGREES = 90;
const LOCATION_MAX_AGE_MS = 15 * 1000;
const CLEANUP_INTERVAL_MS = 1000;

// Para múltiplas instâncias/replicas, substituir estes Maps por Redis ou banco.
const clientsBySocketId = new Map();
const socketIdByClientId = new Map();
const pendingMessages = new Map();

app.get('/', (req, res) => {
  res.send('Servidor do Radar Geográfico está ONLINE e pronto!');
});

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAngle(angle) {
  const number = asFiniteNumber(angle);
  if (number === null) return null;
  return ((number % 360) + 360) % 360;
}

function angleDifference(a, b) {
  const difference = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(difference, 360 - difference);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const latitude1 = lat1 * Math.PI / 180;
  const latitude2 = lat2 * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Bearing geográfico, em graus, partindo do ponto do disparo até o receptor.
function bearingDegrees(fromLat, fromLon, toLat, toLon) {
  const latitude1 = fromLat * Math.PI / 180;
  const latitude2 = toLat * Math.PI / 180;
  const deltaLongitude = (toLon - fromLon) * Math.PI / 180;
  const y = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function validCoordinates(lat, lon) {
  return lat !== null && lon !== null
    && lat >= -90 && lat <= 90
    && lon >= -180 && lon <= 180;
}

function removeExpiredMessages(now = Date.now()) {
  for (const [idDisparo, message] of pendingMessages) {
    if (message.expiraEm <= now) {
      pendingMessages.delete(idDisparo);
      console.log(`⌛ [EXPIRADO] Disparo ${idDisparo} descartado após 120 segundos.`);
    }
  }
}

function sendPendingMessagesToClient(client) {
  removeExpiredMessages();
  for (const message of pendingMessages.values()) {
    if (message.remetenteId !== client.clientId) {
      client.socket.emit('disparo_pendente', message);
    }
  }
}

function findBestCandidate(message, now = Date.now()) {
  let bestCandidate = null;

  for (const client of clientsBySocketId.values()) {
    if (client.clientId === message.remetenteId) continue;
    if (!client.location || now - client.location.atualizadoEm > LOCATION_MAX_AGE_MS) continue;

    const distance = haversineMeters(
      message.lat,
      message.lon,
      client.location.latitude,
      client.location.longitude,
    );
    if (distance > message.raioMetros) continue;

    const bearing = bearingDegrees(
      message.lat,
      message.lon,
      client.location.latitude,
      client.location.longitude,
    );
    if (angleDifference(message.anguloDirecao, bearing) > message.toleranciaGraus) continue;

    if (!bestCandidate || distance < bestCandidate.distance) {
      bestCandidate = { client, distance, bearing };
    }
  }

  return bestCandidate;
}

// Node executa os handlers de eventos de forma serial no loop de eventos. Só o primeito a ser encontrado recebe a msg
function tryDeliverMessage(message, now = Date.now()) {
  if (!pendingMessages.has(message.idDisparo) || message.expiraEm <= now) return false;

  const candidate = findBestCandidate(message, now);
  if (!candidate) return false;

  pendingMessages.delete(message.idDisparo);
  const deliveredMessage = {
    ...message,
    entregueEm: now,
    receptorId: candidate.client.clientId,
    distanciaEntregaMetros: Math.round(candidate.distance * 100) / 100,
  };

  candidate.client.socket.emit('mensagem_entregue', deliveredMessage);
  io.to(message.remetenteSocketId).emit('notificacao_recebida_remetente', {
    idDisparo: message.idDisparo,
    remetenteId: message.remetenteId,
    receptorId: candidate.client.clientId,
    distanciaEntregaMetros: deliveredMessage.distanciaEntregaMetros,
    entregueEm: now,
  });

  console.log(`🎯 [ENTREGUE] ${message.idDisparo} -> ${candidate.client.clientId}`
    + ` (${deliveredMessage.distanciaEntregaMetros} m)`);
  return true;
}

function validateDispatch(data) {
  const lat = asFiniteNumber(data && data.lat);
  const lon = asFiniteNumber(data && data.lon);
  const angle = normalizeAngle(data && data.anguloDirecao);
  const remetenteId = typeof (data && data.remetenteId) === 'string'
    ? data.remetenteId.trim() : '';
  const texto = typeof (data && data.texto) === 'string' ? data.texto.trim() : '';

  if (!remetenteId || !texto || !validCoordinates(lat, lon) || angle === null) {
    return null;
  }

  return {
    lat,
    lon,
    anguloDirecao: angle,
    remetenteId,
    texto,
    raioMetros: Math.min(Math.max(asFiniteNumber(data.raioMetros) || DEFAULT_RADIUS_METERS, 1), 5000),
    toleranciaGraus: Math.min(Math.max(asFiniteNumber(data.toleranciaGraus) || DEFAULT_TOLERANCE_DEGREES, 0), 180),
  };
}

const cleanupTimer = setInterval(removeExpiredMessages, CLEANUP_INTERVAL_MS);
if (cleanupTimer.unref) cleanupTimer.unref();

io.on('connection', (socket) => {
  console.log(`📡 [SISTEMA] Smartphone conectado: ${socket.id}`);

  socket.on('registrar_cliente', (data = {}, ack) => {
    const clientId = typeof data.clientId === 'string' ? data.clientId.trim() : '';
    if (!clientId) {
      if (typeof ack === 'function') ack({ ok: false, erro: 'clientId obrigatório' });
      return;
    }

    const previousSocketId = socketIdByClientId.get(clientId);
    if (previousSocketId && previousSocketId !== socket.id) {
      clientsBySocketId.delete(previousSocketId);
    }

    const client = clientsBySocketId.get(socket.id) || { socket };
    client.clientId = clientId;
    clientsBySocketId.set(socket.id, client);
    socketIdByClientId.set(clientId, socket.id);

    sendPendingMessagesToClient(client);
    if (typeof ack === 'function') ack({ ok: true });
    console.log(`👤 [REGISTRADO] ${clientId} (${socket.id})`);
  });

  socket.on('atualizar_localizacao', (data = {}) => {
    const client = clientsBySocketId.get(socket.id);
    if (!client || !client.clientId) {
      console.warn(`⚠️ [LOCALIZAÇÃO IGNORADA] Socket não registrado: ${socket.id}`);
      return;
    }

    const latitude = asFiniteNumber(data.latitude ?? data.lat);
    const longitude = asFiniteNumber(data.longitude ?? data.lon);
    if (!validCoordinates(latitude, longitude)) {
      console.warn(`⚠️ [LOCALIZAÇÃO INVÁLIDA] Cliente ${client.clientId}:`, data);
      return;
    }

    client.location = {
      latitude,
      longitude,
      atualizadoEm: Date.now(),
    };

    removeExpiredMessages();
    for (const message of [...pendingMessages.values()]) {
      tryDeliverMessage(message);
    }
  });

  socket.on('disparar', (data = {}, ack) => {
    const client = clientsBySocketId.get(socket.id);
    const validated = validateDispatch(data);
    if (!client || !client.clientId || !validated) {
      console.warn(`⚠️ [DISPARO REJEITADO] Socket ${socket.id}; registrado=${Boolean(client?.clientId)}`);
      if (typeof ack === 'function') ack({ ok: false, erro: 'disparo inválido ou cliente não registrado' });
      return;
    }

    const idDisparo = typeof data.idDisparo === 'string' && data.idDisparo.trim()
      ? data.idDisparo.trim() : `${client.clientId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (pendingMessages.has(idDisparo)) {
      if (typeof ack === 'function') ack({ ok: false, erro: 'idDisparo já existe' });
      return;
    }

    const criadoEm = Date.now();
    const message = {
      ...validated,
      idDisparo,
      criadoEm,
      expiraEm: criadoEm + TTL_MS,
      ttlMs: TTL_MS,
      remetenteSocketId: socket.id,
    };
    pendingMessages.set(idDisparo, message);

    console.log(`🚀 [DISPARADO] ${idDisparo} por ${client.clientId}; expira em ${TTL_MS / 1000}s`);
    if (typeof ack === 'function') ack({ ok: true, disparo: message });

    // Tenta imediatamente caso já exista um aparelho elegível.
    tryDeliverMessage(message);
  });

  socket.on('confirmar_recebimento', (data = {}) => {
    console.log(`ℹ️ [CONFIRMAÇÃO IGNORADA] ${data.idDisparo || 'sem id'}: entrega já é controlada pelo servidor.`);
  });

  socket.on('disconnect', (reason) => {
    const client = clientsBySocketId.get(socket.id);
    if (client && client.clientId && socketIdByClientId.get(client.clientId) === socket.id) {
      socketIdByClientId.delete(client.clientId);
    }
    clientsBySocketId.delete(socket.id);
    console.log(`❌ [SISTEMA] ${client ? client.clientId : socket.id} desconectado: ${reason}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log('🚀 SERVIDOR DO RADAR GEOGRÁFICO PRONTO!');
  console.log(`📡 Escutando na porta: ${PORT}`);
  console.log(`⏱️ Retenção dos disparos: ${TTL_MS / 1000}s`);
  console.log('====================================================');
});

module.exports = {
  TTL_MS,
  haversineMeters,
  bearingDegrees,
  angleDifference,
};
