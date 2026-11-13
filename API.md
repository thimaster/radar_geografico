# Documentação da API — Radar Geográfico

Esta documentação descreve as interfaces disponíveis no servidor do Radar Geográfico: uma rota HTTP simples, eventos Socket.IO para comunicação em tempo real e funções utilitárias exportadas pelo módulo Node.js.

**Aplicação disponível para testes:** https://radar-geografico.onrender.com/

## Objetivo

O servidor permite que clientes registrados enviem disparos geolocalizados e direcionais. O servidor procura outro cliente conectado que esteja dentro do raio do disparo e dentro da tolerância angular indicada. Quando encontra um candidato, entrega o disparo ao cliente elegível mais próximo e notifica o remetente.

A aplicação não expõe uma API REST para registrar clientes, atualizar localização ou enviar disparos: essas operações são feitas por eventos Socket.IO.

## Acesso

- **URL base:** `https://radar-geografico.onrender.com`
- **Verificação HTTP:** `GET /`
- **Socket.IO:** conecte-se à URL base usando um cliente Socket.IO compatível (o servidor usa Socket.IO 4).
- **Transporte:** gerenciado pelo Socket.IO; normalmente WebSocket ou polling HTTP longo.

Exemplo de instalação do cliente JavaScript:

```bash
npm install socket.io-client
```

Exemplo de conexão no navegador ou em um módulo JavaScript:

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

### `GET /`

Verifica se o servidor está acessível. Não recebe parâmetros.

**Resposta:** texto simples indicando que o servidor está online.

```bash
curl https://radar-geografico.onrender.com/
```

## Eventos Socket.IO públicos

Os nomes abaixo são sensíveis a maiúsculas e minúsculas. Os exemplos usam a instância `socket` criada na seção de acesso.

### 1. `registrar_cliente` — registrar o cliente

Envia um identificador estável para associar a conexão a um cliente. O registro é necessário antes de atualizar a localização ou disparar uma mensagem.

**Parâmetro (`data`):**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `clientId` | `string` | Sim | Identificador do cliente; espaços nas extremidades são removidos e o valor não pode ficar vazio. |

O evento aceita uma função de confirmação (*ack*). Em caso de sucesso retorna `{ ok: true }`; se faltar o identificador retorna `{ ok: false, erro: "clientId obrigatório" }`.

```js
socket.emit('registrar_cliente', { clientId: 'celular-ana' }, (resposta) => {
  if (!resposta.ok) console.error(resposta.erro);
  else console.log('Cliente registrado');
});
```

Se outra conexão se registrar usando o mesmo `clientId`, a conexão anterior deixa de ser considerada ativa para esse cliente.

### 2. `atualizar_localizacao` — informar a localização atual

Atualiza a posição associada à conexão registrada. Uma atualização válida também faz o servidor reavaliar os disparos pendentes.

**Parâmetros (`data`):**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `latitude` ou `lat` | `number` | Sim | Latitude em graus, entre `-90` e `90`. `latitude` tem precedência quando fornecida. |
| `longitude` ou `lon` | `number` | Sim | Longitude em graus, entre `-180` e `180`. `longitude` tem precedência quando fornecida. |

O servidor aceita números ou valores convertíveis em números. Localizações inválidas e atualizações de conexões não registradas são ignoradas; este evento não possui confirmação de resposta.

```js
socket.emit('atualizar_localizacao', {
  latitude: -23.5505,
  longitude: -46.6333,
});
```

### 3. `disparar` — criar e enviar um disparo

Cria um disparo com origem, direção e texto. O servidor tenta entregá-lo imediatamente; se não houver destinatário elegível, mantém-no pendente para novas tentativas até expirar.

**Parâmetros (`data`):**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | --- | --- |
| `remetenteId` | `string` | Sim | Identificador do remetente. Deve corresponder ao cliente registrado nesta conexão. |
| `texto` | `string` | Sim | Conteúdo do disparo; espaços nas extremidades são removidos e o texto não pode ficar vazio. |
| `lat` | `number` | Sim | Latitude de origem, entre `-90` e `90`. |
| `lon` | `number` | Sim | Longitude de origem, entre `-180` e `180`. |
| `anguloDirecao` | `number` | Sim | Direção em graus. É normalizada para o intervalo `[0, 360)`, considerando norte como `0°` e sentido horário. |
| `idDisparo` | `string` | Não | Identificador fornecido pelo cliente. Se omitido ou vazio, o servidor gera um. Um ID que já esteja pendente é rejeitado. |
| `raioMetros` | `number` | Não | Distância máxima para procurar receptor. Padrão: `500`; limitada ao intervalo de `1` a `5000` metros. |
| `toleranciaGraus` | `number` | Não | Diferença angular máxima entre a direção do disparo e o rumo geográfico até o receptor. Padrão: `10`; limitada ao intervalo de `0` a `180` graus. |

A confirmação indica se o disparo foi aceito para processamento, não necessariamente se já foi entregue. Quando aceito, retorna `{ ok: true, disparo: ... }`; quando inválido ou enviado por cliente não registrado, retorna `{ ok: false, erro: "disparo inválido ou cliente não registrado" }`. Um ID que já esteja pendente retorna `{ ok: false, erro: "idDisparo já existe" }`.

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

### 4. `confirmar_recebimento` — compatibilidade sem efeito

O evento pode ser enviado com `{ idDisparo }`, mas não altera o estado da entrega: o servidor controla a entrega automaticamente e ignora essa confirmação.

```js
socket.emit('confirmar_recebimento', { idDisparo: 'teste-001' });
```

## Eventos enviados pelo servidor

Registre os listeners na conexão Socket.IO para acompanhar os disparos e seus resultados.

### `disparo_pendente`

Enviado a clientes registrados diferentes do remetente quando há disparos pendentes, inclusive quando o cliente se registra. O payload contém os dados do disparo, como `idDisparo`, `remetenteId`, `texto`, `lat`, `lon`, `anguloDirecao`, `raioMetros`, `toleranciaGraus`, `criadoEm`, `expiraEm` e `ttlMs` (timestamps em milissegundos desde Unix epoch).

### `mensagem_entregue`

Enviado ao receptor escolhido. Inclui os campos do disparo e acrescenta `entregueEm` (timestamp em milissegundos), `receptorId` e `distanciaEntregaMetros` (distância arredondada a duas casas decimais).

### `entrega_confirmada`

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

1. **Registro:** somente conexões registradas podem atualizar localização ou enviar disparos.
2. **Autoseleção evitada:** o remetente não pode receber o próprio disparo.
3. **Localização recente:** a posição do candidato precisa ter sido atualizada dentro do tempo de vida configurado para as mensagens.
4. **Distância:** a distância é calculada geodesicamente pela fórmula de Haversine; candidatos além de `raioMetros` não são elegíveis.
5. **Direção:** o rumo geográfico do ponto de origem ao candidato precisa estar dentro de `toleranciaGraus` da direção do disparo. A diferença considera o menor arco entre os ângulos (por exemplo, entre `359°` e `1°` são `2°`).
6. **Escolha e unicidade:** se houver mais de um candidato, o mais próximo recebe o disparo. Cada disparo é entregue a apenas um cliente e removido da fila pendente após a entrega.
7. **Expiração:** por padrão, o disparo expira em 120 segundos. O intervalo pode ser alterado pela variável de ambiente `MESSAGE_TTL_MS`, desde que seja um número positivo. Mensagens expiradas são descartadas.
8. **Reavaliação:** o servidor tenta entregar o disparo ao criá-lo e também quando uma localização válida é atualizada.

## Funções utilitárias exportadas pelo módulo

Para uso em Node.js, `server.js` exporta `TTL_MS`, `haversineMeters`, `bearingDegrees` e `angleDifference`. Elas não são endpoints HTTP nem eventos Socket.IO; são funções/valores para importação no próprio código Node.

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
console.log('Diferença angular:', angleDifference(359, 1)); // 2
```

- `haversineMeters(lat1, lon1, lat2, lon2)`: distância em metros entre duas coordenadas.
- `bearingDegrees(fromLat, fromLon, toLat, toLon)`: rumo geográfico em graus, de `0°` a menos de `360°`.
- `angleDifference(a, b)`: menor diferença angular não negativa, em graus.
- `TTL_MS`: tempo de vida configurado para os disparos, em milissegundos.

## Observações e limites

- O servidor mantém clientes e disparos pendentes em memória. Esses dados não são compartilhados entre instâncias e são perdidos ao reiniciar o processo; a implementação recomenda armazenamento compartilhado, como Redis ou banco de dados, para múltiplas réplicas.
- O CORS do servidor permite qualquer origem (`*`). Não há autenticação implementada nos eventos documentados; use a aplicação de teste de acordo com esse comportamento.
- Para testar a troca entre clientes, conecte pelo menos dois clientes distintos, registre cada `clientId`, envie localizações válidas e emita `disparar` a partir de um deles.
