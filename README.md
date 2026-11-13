# Radar Geográfico

Esta documentação descreve as interfaces disponíveis no servidor do Radar Geográfico: uma rota HTTP simples, eventos Socket.IO para comunicação em tempo real e funções utilitárias exportadas pelo módulo Node.js.

Aplicação disponível para testes: https://radar-geografico.onrender.com/

## Objetivo

O servidor permite que clientes registrados enviem disparos geolocalizados e direcionais. O servidor procura outro cliente conectado que esteja dentro do raio do disparo e dentro da tolerância angular indicada. Quando encontra um candidato, entrega o disparo ao cliente elegível mais próximo e notifica o remetente.

A aplicação não expõe uma API REST para registrar clientes, atualizar localização ou enviar disparos: essas operações são feitas por eventos Socket.IO.

## Acesso

- URL base: `https://radar-geografico.onrender.com`
- Verificação HTTP: `GET /`
- Socket.IO: conecte-se à URL base usando um cliente Socket.IO compatível.
- Transporte: WebSocket ou polling HTTP longo, conforme o cliente e o ambiente.

Exemplo de instalação do cliente JavaScript:

```bash
npm install socket.io-client
```

Exemplo de conexão:

```js
import { io } from 'socket.io-client';

const socket = io('https://radar-geografico.onrender.com');

socket.on('connect', () => {
  console.log('Conectado:', socket.id);
});

socket.on('connect_error', (erro) => {
  console.error('Falha ao conectar:', erro.message);
});
```

## Rota HTTP

### GET /

Verifica se o servidor está acessível. Não recebe parâmetros.

Resposta: texto simples informando que o servidor está online.

```bash
curl https://radar-geografico.onrender.com/
```

## Eventos Socket.IO públicos

Os nomes abaixo são sensíveis a maiúsculas e minúsculas. Os exemplos usam a instância `socket` criada na seção de acesso.

### 1. registrar_cliente

Envia um identificador estável para associar a conexão a um cliente. O registro é necessário antes de atualizar a localização ou disparar uma mensagem.

Parâmetro `data`:

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `clientId` | `string` | Sim | Identificador do cliente; espaços nas extremidades são removidos e o valor não pode ficar vazio. |

O evento aceita uma função de confirmação (`ack`). Em caso de sucesso retorna `{ ok: true }`. Se faltar o identificador, retorna `{ ok: false, erro: "clientId obrigatório" }`.

```js
socket.emit('registrar_cliente', { clientId: 'celular-ana' }, (resposta) => {
  if (!resposta.ok) console.error(resposta.erro);
  else console.log('Cliente registrado');
});
```

Se outra conexão se registrar usando o mesmo `clientId`, a conexão anterior deixa de ser considerada ativa para esse cliente.

### 2. atualizar_localizacao

Atualiza a posição associada à conexão registrada. Uma atualização válida também faz o servidor reavaliar os disparos pendentes.

Parâmetros `data`:

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `latitude` ou `lat` | `number` | Sim | Latitude em graus, entre `-90` e `90`. `latitude` tem precedência quando fornecida. |
| `longitude` ou `lon` | `number` | Sim | Longitude em graus, entre `-180` e `180`. `longitude` tem precedência quando fornecida. |

O servidor aceita números ou valores convertíveis em números. Localizações inválidas e atualizações de conexões não registradas são ignoradas.

```js
socket.emit('atualizar_localizacao', {
  latitude: -23.5505,
  longitude: -46.6333,
});
```

### 3. disparar

Cria um disparo com origem, direção e texto. O servidor tenta entregá-lo imediatamente; se não houver destinatário elegível, mantém-no pendente para novas tentativas até expirar.

Parâmetros `data`:

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `remetenteId` | `string` | Sim | Identificador do remetente. Deve corresponder ao cliente registrado nesta conexão. |
| `texto` | `string` | Sim | Conteúdo do disparo; espaços nas extremidades são removidos e o texto não pode ficar vazio. |
| `lat` | `number` | Sim | Latitude de origem, entre `-90` e `90`. |
| `lon` | `number` | Sim | Longitude de origem, entre `-180` e `180`. |
| `anguloDirecao` | `number` | Sim | Direção em graus. É normalizada para o intervalo `[0, 360)`, considerando norte como `0°` e sentido horário. |
| `idDisparo` | `string` | Não | Identificador fornecido pelo cliente. Se omitido ou vazio, o servidor gera um. |
| `raioMetros` | `number` | Não | Distância máxima para procurar receptor. Padrão: `500`; limitada ao intervalo de `1` a `5000` metros. |
| `toleranciaGraus` | `number` | Não | Diferença angular máxima. Padrão: `10`; limitada ao intervalo de `0` a `180` graus. |

Confirmação:

- sucesso: `{ ok: true, disparo: ... }`
- erro: `{ ok: false, erro: "disparo inválido ou cliente não registrado" }`
- ID duplicado: `{ ok: false, erro: "idDisparo já existe" }`

```js
socket.emit('disparar', {
  idDisparo: 'teste-001',
  remetenteId: 'celular-ana',
  texto: 'Olá, alguém está por perto?',
  lat: -23.5505,
  lon: -46.6333,
  anguloDirecao: 45,
  raioMetros: 800,
  toleranciaGraus: 15,
}, (resposta) => {
  if (!resposta.ok) {
    console.error('Disparo rejeitado:', resposta.erro);
    return;
  }
  console.log('Disparo aceito:', resposta.disparo);
});
```

### 4. confirmar_recebimento

O evento pode ser enviado com `{ idDisparo }`, mas não altera o estado da entrega: o servidor controla a entrega automaticamente e ignora essa confirmação.

```js
socket.emit('confirmar_recebimento', { idDisparo: 'teste-001' });
```

## Eventos enviados pelo servidor

### disparo_pendente

Enviado a clientes registrados diferentes do remetente quando há disparos pendentes, inclusive quando o cliente se registra.

### mensagem_entregue

Enviado ao receptor escolhido. Inclui os campos do disparo e acrescenta `entregueEm`, `receptorId` e `distanciaEntregaMetros`.

### entrega_confirmada

Enviado ao remetente quando a entrega acontece. Inclui `idDisparo`, `remetenteId`, `receptorId`, `distanciaEntregaMetros` e `entregueEm`.

```js
socket.on('disparo_pendente', (disparo) => {
  console.log('Disparo aguardando receptor:', disparo);
});

socket.on('mensagem_entregue', (mensagem) => {
  console.log('Mensagem recebida:', mensagem.texto, 'de', mensagem.remetenteId);
});

socket.on('entrega_confirmada', (confirmacao) => {
  console.log('Entrega confirmada:', confirmacao);
});
```

## Critérios de funcionamento

1. Registro: somente conexões registradas podem atualizar localização ou enviar disparos.
2. Autoseleção evitada: o remetente não pode receber o próprio disparo.
3. Localização recente: a posição do candidato precisa ter sido atualizada dentro do tempo de vida configurado para as mensagens.
4. Distância: a distância é calculada geodesicamente pela fórmula de Haversine; candidatos além do raio não são elegíveis.
5. Direção: o rumo geográfico do ponto de origem ao candidato precisa estar dentro da tolerância angular da direção do disparo.
6. Escolha e unicidade: se houver mais de um candidato, o mais próximo recebe o disparo. Cada disparo é entregue a apenas um cliente.
7. Expiração: por padrão, o disparo expira em 120 segundos. O intervalo pode ser alterado pela variável de ambiente `MESSAGE_TTL_MS`.
8. Reavaliação: o servidor tenta entregar o disparo ao criá-lo e também quando uma localização válida é atualizada.

## Funções utilitárias exportadas pelo módulo

Para uso em Node.js, `server.js` exporta `TTL_MS`, `haversineMeters`, `bearingDegrees` e `angleDifference`.

```js
const {
  TTL_MS,
  haversineMeters,
  bearingDegrees,
  angleDifference,
} = require('./server');

console.log('TTL configurado (ms):', TTL_MS);
console.log('Distância (m):', haversineMeters(-23.5505, -46.6333, -23.561, -46.655));
console.log('Rumo (graus):', bearingDegrees(-23.5505, -46.6333, -23.561, -46.655));
console.log('Diferença angular:', angleDifference(359, 1));
```

- `haversineMeters(lat1, lon1, lat2, lon2)`: distância em metros entre duas coordenadas.
- `bearingDegrees(fromLat, fromLon, toLat, toLon)`: rumo geográfico em graus.
- `angleDifference(a, b)`: menor diferença angular entre dois ângulos.
- `TTL_MS`: tempo de vida dos disparos em milissegundos.

## Observações e limites

- O servidor mantém clientes e disparos pendentes em memória. Esses dados não são compartilhados entre instâncias.
- O CORS do servidor permite qualquer origem (`*`). Não há autenticação implementada.
- Para testar a troca entre clientes, conecte pelo menos dois clientes distintos, registre cada `clientId`, envie localizações válidas e emita `disparar` a partir de um deles.

## Instalação e execução

```bash
npm install
npm start
```

O servidor padrão escuta na porta `3000` e também aceita a variável de ambiente `PORT`.

## Status

Servidor online para testes em: https://radar-geografico.onrender.com/
