const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Charger les variables d'environnement depuis .env
dotenv.config();

// Récupérer l'URI de MongoDB depuis .env
const MONGO_URI = process.env.MONGO_URI;

// Connexion à MongoDB
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✅ Connecté à MongoDB'))
  .catch(err => {
    console.error('❌ Erreur de connexion MongoDB:', err);
    process.exit(1);
  });

// Définition du modèle Utilisateur
const userSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  username: String,
  referrer_id: Number,
  invited_count: { type: Number, default: 0 },
  tickets: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  joined_channels: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Définition du modèle Retrait
const withdrawalSchema = new mongoose.Schema({
  userId: Number,
  amount: Number,
  paymentMethod: String,
  country: String,
  phone: String,
  email: String,
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

module.exports = { User, Withdrawal };
