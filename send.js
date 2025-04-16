require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
const Bottleneck = require('bottleneck');

// Configuration du bot et de MongoDB
const bot = new Telegraf(process.env.BOT_TOKEN);
const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const ADMINS = process.env.ADMINS.split(',').map(Number); // Ex: "12345678,87654321" => [12345678, 87654321]

const BROADCAST_CONFIG = {
  MAX_CONCURRENT: 30,         // Nombre maximum de messages envoyés en parallèle
  MIN_TIME: 50,               // Délai minimal entre chaque envoi (ms)
  RETRY_COUNT: 2,             // Nombre de tentatives de réessai
  STATS_UPDATE_INTERVAL: 3000 // Intervalle de mise à jour des statistiques (ms)
};

const limiter = new Bottleneck({
  maxConcurrent: BROADCAST_CONFIG.MAX_CONCURRENT,
  minTime: BROADCAST_CONFIG.MIN_TIME,
  reservoir: 30,
  reservoirRefreshInterval: 1000,
  reservoirRefreshAmount: 30,
});

// État global de la diffusion
let broadcastState = {
  active: false,
  pendingMessage: null,
  totalUsers: 0,
  processed: 0,
  success: 0,
  failed: 0,
  startTime: null,
  statsInterval: null,
  statusMessageId: null,
};

// Connexion et gestion de la base de données MongoDB
async function getDb() {
  if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
    await mongoClient.connect();
  }
  return mongoClient.db(process.env.DB_NAME);
}

// Sauvegarde d'un utilisateur lors de /start
async function saveUser(user) {
  const db = await getDb();
  await db.collection('users').updateOne(
    { id: user.id },
    {
      $set: {
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        last_activity: new Date()
      }
    },
    { upsert: true }
  );
}

// Récupère tous les identifiants des utilisateurs inscrits
async function getAllUserIds() {
  const db = await getDb();
  const users = await db.collection('users').find({}, { projection: { id: 1 } }).toArray();
  return users.map(u => u.id);
}

// Détermine le type de message reçu
function getMessageType(message) {
  if (message.text) return 'text';
  if (message.photo) return 'photo';
  if (message.video) return 'video';
  return 'unknown';
}

// Estime la durée de la diffusion
function estimateBroadcastDuration(userCount) {
  const seconds = Math.round((userCount * BROADCAST_CONFIG.MIN_TIME) / 1000);
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

// Commande /start pour enregistrer l'utilisateur
bot.start(async (ctx) => {
  await saveUser(ctx.from);
  ctx.reply("✅ Vous êtes maintenant inscrit aux notifications !");
});

// Commande admin /send pour activer la diffusion (mode ads)
bot.command('send', async (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return;
  ctx.reply("📨 Envoyez le message à diffuser (texte, photo, vidéo, etc.)");
  broadcastState.pendingMessage = null;
});

// Réception du message à diffuser (uniquement si envoyé par un admin)
bot.on('message', async (ctx) => {
  if (!ADMINS.includes(ctx.from.id)) return;
  if (broadcastState.active) return; // Si une diffusion est en cours, on ignore les nouveaux messages.
  if (!broadcastState.pendingMessage) {
    broadcastState.pendingMessage = ctx.message;
    const db = await getDb();
    const userCount = await db.collection('users').countDocuments();
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅ Confirmer', 'confirm_broadcast'),
      Markup.button.callback('❌ Annuler', 'cancel_broadcast')
    ]);
    await ctx.reply(
      `⚠️ Confirmez la diffusion à ${userCount} utilisateurs\n` +
      `Type: ${getMessageType(ctx.message)}\n` +
      `Durée estimée: ${estimateBroadcastDuration(userCount)}`,
      keyboard
    );
  }
});

// Annulation de la diffusion
bot.action('cancel_broadcast', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('❌ Diffusion annulée');
  resetBroadcastState();
});

// Confirmation et lancement de la diffusion
bot.action('confirm_broadcast', async (ctx) => {
  if (broadcastState.active || !broadcastState.pendingMessage) return;
  broadcastState.active = true;
  broadcastState.startTime = Date.now();
  broadcastState.statusMessageId = ctx.callbackQuery.message.message_id;
  try {
    const db = await getDb();
    const userCount = await db.collection('users').countDocuments();
    broadcastState.totalUsers = userCount;
    await ctx.answerCbQuery('🚀 Début de la diffusion...');
    await updateProgress(ctx);
    // Lancement des mises à jour périodiques du statut
    broadcastState.statsInterval = setInterval(() => updateProgress(ctx), BROADCAST_CONFIG.STATS_UPDATE_INTERVAL);
    // Récupère tous les utilisateurs et envoie en parallèle avec gestion de la limitation
    const users = await getAllUserIds();
    await processBatch(users, ctx);
    await finalizeBroadcast(ctx);
  } catch (error) {
    console.error('Erreur critique:', error);
    await ctx.telegram.sendMessage(ctx.from.id, `❌ Erreur de diffusion: ${error.message}`);
  } finally {
    resetBroadcastState();
  }
});

// Traitement d'un lot d'utilisateurs
async function processBatch(users, ctx) {
  const tasks = users.map(userId => {
    return limiter.schedule(() => 
      sendWithRetry(userId, broadcastState.pendingMessage)
        .then(() => { broadcastState.success++; })
        .catch(() => { broadcastState.failed++; })
        .then(() => { broadcastState.processed++; })
    );
  });
  await Promise.allSettled(tasks);
}

// Envoi de message avec réessai
async function sendWithRetry(userId, message, attempt = 1) {
  try {
    await sendMessage(userId, message);
  } catch (error) {
    if (attempt < BROADCAST_CONFIG.RETRY_COUNT) {
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
      return sendWithRetry(userId, message, attempt + 1);
    }
    console.error(`❌ Échec d'envoi à ${userId} après ${attempt} tentatives.`);
    throw error;
  }
}

// Envoi du message selon le type (texte, photo, vidéo)
async function sendMessage(userId, message) {
  try {
    if (message.text) {
      await bot.telegram.sendMessage(userId, message.text);
    } else if (message.photo) {
      // Pour les photos, on utilise le premier élément du tableau
      await bot.telegram.sendPhoto(userId, message.photo[0].file_id, { caption: message.caption || '' });
    } else if (message.video) {
      await bot.telegram.sendVideo(userId, message.video.file_id, { caption: message.caption || '' });
    }
  } catch (error) {
    error.userId = userId;
    throw error;
  }
}

// Mise à jour en temps réel des statistiques de diffusion
async function updateProgress(ctx) {
  const elapsed = Math.floor((Date.now() - broadcastState.startTime) / 1000);
  const progress = (broadcastState.processed / broadcastState.totalUsers) * 100;
  const speed = Math.round(broadcastState.processed / elapsed) || 0;
  const statsMessage =
`⏳ Progression : ${Math.round(progress)}% (${broadcastState.processed}/${broadcastState.totalUsers})
⏱ Temps écoulé : ${elapsed}s
📤 Vitesse : ${speed} msg/s
✅ Réussis : ${broadcastState.success}
❌ Échecs : ${broadcastState.failed}`;
  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      broadcastState.statusMessageId,
      null,
      statsMessage
    );
  } catch (error) {
    console.error('Erreur de mise à jour:', error.message);
  }
}

// Finalisation de la diffusion et affichage du bilan final
async function finalizeBroadcast(ctx) {
  clearInterval(broadcastState.statsInterval);
  const totalTime = Math.floor((Date.now() - broadcastState.startTime) / 1000);
  const finalMessage =
`🏁 Diffusion terminée !
Durée totale : ${totalTime}s
Utilisateurs atteints : ${broadcastState.success}/${broadcastState.totalUsers}
Taux de succès : ${((broadcastState.success / broadcastState.totalUsers) * 100).toFixed(1)}%`;
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    broadcastState.statusMessageId,
    null,
    finalMessage
  );
}

// Réinitialise l'état de la diffusion
function resetBroadcastState() {
  broadcastState = {
    active: false,
    pendingMessage: null,
    totalUsers: 0,
    processed: 0,
    success: 0,
    failed: 0,
    startTime: null,
    statsInterval: null,
    statusMessageId: null,
  };
}

// Gestion globale des erreurs non capturées
process.on('uncaughtException', async (error) => {
  console.error('Erreur non capturée:', error);
  await mongoClient.close();
  process.exit(1);
});

// Lancement du bot avec un timeout de gestionnaire adapté (10 minutes)
bot.launch({
  handlerTimeout: 600000 // 10 minutes en ms
}).then(() => {
  console.log('🤖 Bot démarré avec succès');
});
