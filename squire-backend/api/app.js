// Main Express App Setup
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT || 1000, // Limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Import routes
const profileRoutes = require('./routes/profiles');
const sessionRoutes = require('./routes/sessions');
const suggestionRoutes = require('./routes/suggestions');
const eventRoutes = require('./routes/events');
const knowledgeRoutes = require('./routes/knowledge');
const analyticsRoutes = require('./routes/analytics');
const managementRoutes = require('./routes/management');

// API routes
app.use('/api/profiles', profileRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/suggestions', suggestionRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/management', managementRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Squire Backend API',
    version: '1.0.0',
    documentation: '/api/docs',
    routes: {
      profiles: '/api/profiles',
      sessions: '/api/sessions',
      suggestions: '/api/suggestions',
      events: '/api/events',
      knowledge: '/api/knowledge',
      analytics: '/api/analytics',
      management: '/api/management'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    availableRoutes: [
      'GET /health',
      'GET /api',
      'GET /api/profiles/:id',
      'POST /api/sessions/start',
      'GET /api/analytics/dashboard/:userId'
    ]
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Squire Backend API running on port ${PORT}`);
  console.log(`📚 API Documentation available at: http://localhost:${PORT}/api`);
  console.log(`❤️ Health check available at: http://localhost:${PORT}/health`);
});

module.exports = app;