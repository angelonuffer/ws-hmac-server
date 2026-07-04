# WebSocket HMAC Server

Servidor WebSocket em Node.js focado em troca de mensagens baseadas em texto e roteamento por identificadores (UUIDs) com autenticação via HMAC.

## Configurações do Servidor (Variáveis de Ambiente)

O servidor é configurado através das seguintes variáveis de ambiente:

- `HOST`: Endereço de rede onde o servidor vai rodar (Padrão: `0.0.0.0`).
- `PORT`: Porta de escuta do servidor (Padrão: `8080`).
- `SERVER_SECRET`: Chave criptográfica usada para assinar e validar IDs (**Obrigatório**).
- `ALLOWED_ORIGINS`: Lista de origens permitidas (separadas por vírgula) para proteção de conexões. Suporta wildcards no início (ex: `*.exemplo.com`). Conexões sem Origin ou de origens não listadas são rejeitadas.
- `MAX_MESSAGE_SIZE`: Limite máximo de caracteres por mensagem (Padrão: `65536`).

## Protocolo de Mensagens

Todas as mensagens trafegam como uma única string. A separação de dados é feita por posição (slice).

### Comandos de Controle (Iniciados com `!`)

#### Geração de Identidade (`!request_id`)
O cliente envia `!request_id`.
O servidor cria um UUID v4, gera uma assinatura HMAC-SHA256 usando o `SERVER_SECRET` e responde com `!credentials<uuid><assinatura>`.
- `uuid`: 36 caracteres.
- `assinatura`: HMAC-SHA256 em formato Base64 (aprox. 44 caracteres).

#### Autenticação/Vínculo (`!auth`)
O cliente envia `!auth<uuid><assinatura>`.
O servidor valida o par (ID + Assinatura). Se válido, vincula a conexão atual àquele ID.
- **Regra de Multi-conexão**: Um mesmo ID pode ser validado por múltiplas conexões simultâneas.

### Troca de Mensagens Padrão

#### Cliente -> Servidor
O cliente envia os primeiros 36 caracteres contendo o ID de destino, seguido imediatamente pelo conteúdo da mensagem.
Formato: `<id_destino><conteúdo_da_mensagem>`

#### Servidor -> Cliente (Relay)
O servidor identifica quem enviou a mensagem e a repassa ao destino, substituindo o ID de destino pelo ID de origem.
Formato: `<id_origem><conteúdo_da_mensagem>`

**Regras de Relay:**
- O remetente deve estar autenticado.
- A mensagem é enviada para todas as conexões ativas vinculadas ao `id_destino`, **exceto** para a conexão que enviou a mensagem (mesmo que ela compartilhe o mesmo ID).

### Mensagens de Erro e Aviso
- `!error<mensagem>`: Enviado pelo servidor em caso de falha na autenticação, comando inválido ou erro de formato.
- `!notice<mensagem>`: Enviado quando o ID de destino não possui conexões ativas.

## Execução

### Requisitos
- Node.js v18 ou superior.

### Instalação
```bash
npm install
```

### Iniciar o Servidor
```bash
export SERVER_SECRET="sua_chave_secreta"
export ALLOWED_ORIGINS="http://seuapp.com,*.exemplo.com"
npm start
```

### Testes
```bash
npm test
```
