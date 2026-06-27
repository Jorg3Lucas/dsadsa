# 🏰 Claim Bot — Multi-Server Edition

Bot Discord para gerenciamento de claims (Secret Peak, Magic Square, Antidemon, Summon) com suporte a **múltiplos servidores**, **múltiplos continentes/ fusos horários** e **múltiplos idiomas**.

> Esta branch (`claimed`) contém **apenas** o sistema de claim — sem ranking MIR4, salary poll, temp voice, tickets ou outros sistemas auxiliares.

---

## 📋 Funcionalidades

- **Secret Peak (7F–10F):** Claim com janela de 30min, bosses Left/Red/Right/Plant/Ore com cooldown individual
- **Magic Square (7F–12F):** Normal (Leaders 1-3 + Plant/Ore), Fury, Frenzy (eventos agendados)
- **Antidemon (7F–10F):** 3 salas (Left/Mid/Right) com sistema de tickets (30/60/90min) e fila
- **Summon Locations:** SP 2F/4F/7F, MS 11 Goblin, SP 11F/12F Goblin com tickets e fila
- **Painéis interativos:** Embeds com botões para claim, cancelar, marcar kill, entrar na fila
- **Notificações DM:** Avisos de turno, expiração, respawn de boss, ausência
- **Relatórios diários:** Logs estruturados enviados automaticamente às 18:00 (fuso configurável)
- **Comandos admin:** `!reset`, `!kick`, `!logs`, `!setlogs`, `!setbosschannel`, `!seteventchannel`

---

## 🏗️ Arquitetura Multi-Servidor

Cada servidor Discord (guild) tem seus **próprios dados isolados**, permitindo que uma única instância do bot atenda múltiplos servidores simultaneamente.

### Estrutura de Dados

```
data/
├── database_{guildId}.json      # Dados dos painéis (floors, claims, queues)
├── punishments_{guildId}.json    # Cooldowns por usuário
└── daily-logs_{guildId}.json     # Logs diários de atividade
```

Cada guild possui seu próprio estado em memória, gerenciado pelo `state.js`:

| Componente | Descrição |
|-----------|-----------|
| `db` | Mapa de painéis (Secret Peak, Magic Square, etc.) |
| `lastMessages` | Cache de mensagens dos painéis para atualização |
| `punishments` | Cooldowns de 5min após cancelamento |
| `dailyLogs` | Fila de logs + canais configurados |
| `alertCache` | Cache para evitar alerts duplicados |
| `antiDemonSelectionCache` | Estado temporário de seleção antidemon |
| `summonSelectionCache` | Estado temporário de seleção summon |
| `timezone` | Fuso horário configurável (ex: Europe/Berlin) |

### Fluxo de Inicialização

```
index.js (ready event)
  ├── Para cada guild no client.guilds.cache:
  │     ├── initGuildState(guildId)     → Cria/carrega estado isolado
  │     └── initClaimSystem(guildId)    → Inicializa painéis padrão + migrações
  └── startAutoBackup(6)               → Backup automático a cada 6h
```

### Fluxo de Interação

```
Usuário clica botão → interactionCreate
  ├── getGuildState(interaction.guildId)  → Obtém estado da guild
  ├── handleClaimInteractions(interaction)
  │     └── Roteia para handler específico (floor, antidemon, admin, etc.)
  │           └── Cada handler usa getDb(guildId) para dados da guild
  └── state.saveLocalStorage()            → Persiste alterações
```

### Tick Interval (15s)

O `panel-tick.js` executa a cada 15 segundos e **itera por todas as guilds**:

```
startTickInterval()
  └── A cada 15s:
        └── Para cada guildState em getAllGuildStates():
              ├── Verifica expiração de claims
              ├── Gerencia filas (grace period, ausência)
              ├── Atualiza respawn de bosses (cooldown)
              ├── Dispara notificações DM
              └── Atualiza painéis visuais
```

---

## 🌍 Suporte a Múltiplos Continentes

O fuso horário é **configurável por guild** através do parâmetro `timezone` em `initGuildState()`.

```js
initGuildState(guildId, {
  client,
  timezone: "America/Sao_Paulo",  // Europa/Berlin, Asia/Seoul, etc.
});
```

- `getLocalTime(timezone)` retorna a hora local do fuso configurado
- Todos os schedules (Red Boss, Leader 3, Fury/Frenzy) respeitam o fuso da guild
- `parseStringToDate()` aceita timezone para parsing correto de horários

### Continentes suportados (exemplos)
| Continente | Timezone |
|-----------|----------|
| Europa | `Europe/Berlin` |
| América do Sul | `America/Sao_Paulo` |
| América do Norte | `America/New_York` |
| Ásia | `Asia/Seoul`, `Asia/Tokyo`, `Asia/Shanghai` |

---

## 🌐 Suporte a Múltiplos Idiomas

Sistema i18n via `lang.js` + `lang.json`:

- `getMsg("rooms.floorClaimSuccess")` → retorna a string no idioma carregado
- `getArray("tickets")` → retorna array de opções de tickets
- `reloadLanguage()` → recarrega o arquivo de idioma em runtime

Para adicionar um novo idioma, substitua ou estenda o `lang.json` com as traduções.

---

## 📁 Estrutura de Arquivos

```
├── index.js                     # Entry point multi-servidor
├── bot.js                       # Inicialização do sistema de claim por guild
├── state.js                     # Gerenciador de estado multi-guild
├── claim-core.js                # Lógica central de claim/queue/punições
├── claim-handlers.js            # Roteador de comandos/interações
├── panel-render.js              # Renderização de embeds e botões
├── panel-utils.js               # Utilitários de painel + migrações
├── panel-tick.js                # Tick interval (15s) multi-guild
├── daily-logs.js                # Sistema de logs diários por guild
├── time-utils.js                # Utilitários de tempo com timezone
├── constants.js                 # Constantes (cores, status)
├── lang.js + lang.json          # Sistema de internacionalização
├── auto-backup.js               # Backup automático de dados
├── commands/
│   ├── admin-commands.js        # !setlogs, !kick, !reset, etc.
│   └── panel-commands.js        # !ms, !sp, !summon
├── interactions/
│   ├── floor-interactions.js    # Botões de claim/cancel/kill
│   ├── admin-interactions.js    # Menus admin (reset, kick)
│   ├── antidemon-interactions.js # Seleção de salas + tickets
│   └── summon-interactions.js   # Seleção de locais + tickets
└── data/                        # Dados persistidos por guild (gitignored)
```

---

## 🚀 Como Usar

### Configuração

```bash
cp .env.example .env
# Edite .env com seu TOKEN do Discord
```

### Iniciar

```bash
npm start
# Ou: node index.js
```

### Comandos no Discord

| Comando | Descrição |
|---------|-----------|
| `!ms 7` | Painel Magic Square 7F (normal + antidemon) |
| `!sp 7` | Painel Secret Peak 7F |
| `!summon` | Painel Summon Locations |
| `!reset` | Menu para resetar painéis |
| `!kick` | Menu para remover claims |
| `!setlogs` | Configura canal de relatórios |
| `!logs` | Envia relatório manual |
| `!setbosschannel` | Canal de alertas de boss |
| `!seteventchannel` | Canal de alertas de eventos |

---

## 🔧 Dependências

- `discord.js` ^14 — API do Discord
- `axios` — Envio de arquivos via REST
- `dotenv` — Variáveis de ambiente

---

## 📄 Licença

ISC
