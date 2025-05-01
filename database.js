// database.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Charger les variables d'environnement
dotenv.config();

// Configuration de la connexion MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });
    console.log('✅ Connecté à MongoDB avec succès');
  } catch (error) {
    console.error('❌ Erreur de connexion MongoDB:', error.message);
    process.exit(1);
  }
};

// Schéma Utilisateur
const UserSchema = new mongoose.Schema({
  id: { 
    type: Number, 
    required: true, 
    unique: true,
    index: true 
  },
  username: {
    type: String,
    trim: true
  },
  referrer_id: {
    type: Number,
    index: true,
    default: null
  },
  invited_count: {
    type: Number,
    default: 0,
    min: 0
  },
  tickets: {
    type: Number,
    default: 0,
    min: 0
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  joined_channels: {
    type: Boolean,
    default: false
  },
  last_active: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Schéma Retrait
const WithdrawalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userId: {
    type: Number,
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 10000
  },
  method: {
    type: String,
    required: true,
    enum: ['Mobile Money', 'Carte Bancaire']
  },
  phone: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'processed', 'rejected'],
    default: 'pending'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Schéma Diffusion (Ads)
const AdsSchema = new mongoose.Schema({
  content: {
    type: {
      type: String,
      required: true,
      enum: ['text', 'photo', 'video', 'document', 'audio']
    },
    data: mongoose.Schema.Types.Mixed,
    caption: String
  },
  sent_count: {
    type: Number,
    default: 0
  },
  failed_count: {
    type: Number,
    default: 0
  },
  initiated_by: {
    type: Number,
    required: true
  }
}, {
  timestamps: true,
  toObject: { virtuals: true }
});

// Indexes pour optimiser les requêtes
UserSchema.index({ referrer_id: 1, invited_count: -1 });
WithdrawalSchema.index({ userId: 1, status: 1 });
AdsSchema.index({ createdAt: -1 });

// Modèles Mongoose
const User = mongoose.model('User', UserSchema);
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);
const Ads = mongoose.model('Ads', AdsSchema);

module.exports = {
  connectDB,
  User,
  Withdrawal,
  Ads
};
