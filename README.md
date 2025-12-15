# 📈 Market Watcher

A real-time trading dashboard built with React, TypeScript, and Node.js that provides live market data, WebSocket-powered price updates, and comprehensive stock analysis tools.

## 🚀 Features

### 💹 Real-Time Market Data
- **Live Price Updates**: WebSocket-powered real-time stock price broadcasting every 5 seconds
- **Market Movers**: Automatic top gainers and losers updates every 30 seconds
- **Yahoo Finance Integration**: Direct integration with Yahoo Finance API for accurate market data
- **Popular Stocks Tracking**: AAPL, GOOGL, MSFT, TSLA, NVDA, AMZN with live updates

### 🗄️ Advanced Data Storage
- **ClickHouse Integration**: High-performance time-series database for storing historical stock data
- **Optimized Tables**: Partitioned tables for efficient querying of large datasets
- **Historical Data**: Query historical stock quotes and market movements
- **Data Retention**: Automatic data cleanup with configurable retention policies

### 🎨 Modern UI/UX
- **shadcn/ui Components**: Beautiful, accessible UI components built on Radix UI
- **Tailwind CSS**: Utility-first CSS framework for responsive design
- **Dark/Light Themes**: Modern theming with system preference detection
- **Responsive Design**: Mobile-first approach for all device sizes

### 🔧 Developer Experience
- **TypeScript**: Full type safety across the entire application
- **Vite**: Lightning-fast development server and optimized production builds
- **ESLint**: Code quality and consistency enforcement
- **Modular Architecture**: Clean, maintainable code structure

## 🏗️ Architecture

### Backend Structure
```
server/
├── api/
│   ├── controllers/     # Request/response handlers
│   └── routes/         # API endpoint definitions
├── websocket/          # Real-time communication
├── services/           # Business logic (Yahoo Finance, ClickHouse)
├── middleware/         # Express middleware
├── config/            # Configuration management
├── storage/           # Data persistence interfaces
└── utils/             # Helper functions
```

### Frontend Structure
```
client/src/
├── components/        # Reusable UI components
├── hooks/            # Custom React hooks
├── pages/            # Page components
├── lib/              # Utilities and configurations
└── types/            # TypeScript type definitions
```

## 🛠️ Tech Stack

### Frontend
- **React 18** - Modern React with hooks and concurrent features
- **TypeScript** - Type-safe JavaScript
- **Vite** - Fast build tool and dev server
- **shadcn/ui** - Modern UI component library
- **Tailwind CSS** - Utility-first CSS framework
- **TanStack Query** - Powerful data fetching and caching
- **Wouter** - Lightweight routing library

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web framework for Node.js
- **WebSocket** - Real-time bidirectional communication
- **ClickHouse** - High-performance analytical database
- **Yahoo Finance 2** - Financial market data API
- **Drizzle ORM** - Type-safe SQL query builder

### Development Tools
- **tsx** - TypeScript execution environment
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **dotenv** - Environment variable management

## 🚀 Getting Started

### Prerequisites
- **Node.js** 18+ and npm
- **ClickHouse** (optional - app works without it)
- **PostgreSQL** (for user authentication - optional)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/market-watcher.git
   cd market-watcher
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   ```

   Configure your `.env` file:
   ```env
   # Database Configuration
   DATABASE_URL=postgresql://username:password@localhost:5432/market_watcher

   # ClickHouse Configuration (optional)
   CLICKHOUSE_HOST=localhost
   CLICKHOUSE_PORT=8123
   CLICKHOUSE_USERNAME=default
   CLICKHOUSE_PASSWORD=
   CLICKHOUSE_DATABASE=market_data

   # Server Configuration
   PORT=3001
   NODE_ENV=development
   ```

4. **Database Setup** (optional)
   - Install and start ClickHouse locally
   - The app will create tables automatically on startup

### Running the Application

#### Development Mode
```bash
# Start both client and server
npm run dev

# Or run separately:
npm run dev:client    # Client on http://localhost:5000
npm run dev           # Server on http://localhost:3001
```

#### Production Build
```bash
# Build the application
npm run build

# Start production server
npm start
```

## 📡 API Endpoints

### Stock Data
- `GET /api/stocks/:symbol/quote` - Get current stock quote
- `GET /api/stocks/:symbol/history` - Get historical price data
- `GET /api/stocks/:symbol/history-clickhouse` - Get historical data from ClickHouse

### Market Data
- `GET /api/market/movers/:type` - Get market movers (gainers/losers)
- `GET /api/market/trending` - Get trending symbols
- `GET /api/market/movers/history-clickhouse` - Get historical market movers

### WebSocket Events
- `price_update` - Real-time price updates
- `market_movers_update` - Top gainers/losers updates

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required for auth |
| `CLICKHOUSE_HOST` | ClickHouse server host | `localhost` |
| `CLICKHOUSE_PORT` | ClickHouse server port | `8123` |
| `CLICKHOUSE_USERNAME` | ClickHouse username | `default` |
| `CLICKHOUSE_PASSWORD` | ClickHouse password | `""` |
| `CLICKHOUSE_DATABASE` | ClickHouse database name | `market_data` |
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment mode | `development` |

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linting
npm run lint

# Type checking
npm run check
```

## 🚀 Deployment

### Docker Deployment
```bash
# Build Docker image
docker build -t market-watcher .

# Run with Docker
docker run -p 3001:3001 market-watcher
```

### Environment Setup
- Set `NODE_ENV=production`
- Configure production database URLs
- Set up ClickHouse cluster for high availability
- Configure reverse proxy (nginx/Caddy)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript strict mode
- Use ESLint and Prettier for code formatting
- Write meaningful commit messages
- Add tests for new features
- Update documentation

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Yahoo Finance](https://finance.yahoo.com/) for market data
- [ClickHouse](https://clickhouse.com/) for high-performance analytics
- [shadcn/ui](https://ui.shadcn.com/) for beautiful UI components
- [Vercel](https://vercel.com/) for inspiration

## 📞 Support

If you have any questions or need help:

- Open an issue on GitHub
- Check the documentation
- Join our Discord community

---

**Happy Trading! 📈🚀**