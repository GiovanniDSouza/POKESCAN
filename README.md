# PokeScan 📱

Um aplicativo de scaneamento e gerenciamento de cards Pokémon com banco de dados integrado e API RESTful.

## 📋 Descrição

**PokeScan** é uma plataforma web que permite aos usuários:
- Escanear e registrar cards Pokémon
- Consultar informações da Pokédex
- Gerenciar coleção de Pokémon
- Visualizar dados detalhados através de uma interface intuitiva

## 🛠️ Tech Stack

- **Frontend**: React, Next.js, TypeScript
- **Backend**: Next.js API Routes
- **Banco de Dados**: SQLite com Drizzle ORM
- **Estilos**: CSS/Tailwind CSS
- **Build Tool**: ESLint para qualidade de código

## 🚀 Getting Started

### Pré-requisitos
- Node.js 16.x ou superior
- npm ou yarn

### Instalação

1. Clone o repositório:
```bash
git clone https://github.com/GiovanniDSouza/POKESCAN.git
cd POKESCAN
```

2. Instale as dependências:
```bash
npm install
```

3. Configure o banco de dados:
```bash
npm run db:push
```

### Desenvolvimento

Para iniciar o servidor de desenvolvimento:

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) no navegador para ver o resultado.

## 📂 Estrutura do Projeto

```
pokescan/
├── app/                    # Aplicação Next.js
│   ├── api/               # Rotas da API
│   │   ├── card/         # Endpoints de cards
│   │   ├── pokemon/      # Endpoints de Pokémon
│   │   ├── pokedex/      # Endpoints da Pokédex
│   │   └── scan/         # Endpoints de scan
│   ├── pokedex/          # Página da Pokédex
│   └── layout.tsx        # Layout principal
├── src/
│   └── db/               # Configuração de banco de dados
│       ├── schema.ts     # Schema do Drizzle
│       ├── seed.ts       # Dados iniciais
│       └── import-pokemon.ts
├── drizzle/              # Migrations
└── package.json
```

## 🔌 API Endpoints

- `GET /api/pokemon` - Lista todos os Pokémon
- `GET /api/pokedex` - Dados da Pokédex
- `POST /api/card` - Criar novo card
- `POST /api/scan` - Registrar novo scan

## 📦 Scripts Disponíveis

- `npm run dev` - Inicia servidor de desenvolvimento
- `npm run build` - Build para produção
- `npm run start` - Executa build de produção
- `npm run lint` - Executa ESLint

## 🗄️ Banco de Dados

O projeto usa SQLite com Drizzle ORM. As migrations estão em `/drizzle`.

Para resetar o banco de dados:
```bash
node cleanup-db.js
```

## 📝 License

Este projeto está sob a licença MIT.

## 👤 Autor

**Giovanni De Souza Ferreira**

---

**Desenvolvido com ❤️ para a comunidade Pokémon**
