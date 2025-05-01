// bot.js - Partie 1/2
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const pLimit = require('p-limit');
const { User, Withdrawal, Ads } = require('./database');

// Configuration initiale
dotenv.config();
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const MONGO_URI = process.env.MONGO_URI;

// Vérification des variables d'environnement
if (!BOT_TOKEN || !ADMIN_ID || !MONGO_URI) {
  console.error('❌ Variables manquantes dans .env');
  process.exit(1);
}

// Initialisation du bot
const bot = new Telegraf(BOT_TOKEN);
const withdrawalProcess = new Map();
const adminSessions = new Map();
const broadcastConcurrency = pLimit(20);

// Connexion MongoDB
mongoose.connect(MONGO_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
})
.then(() => console.log('✅ Connecté à MongoDB'))
.catch(err => {
  console.error('❌ Erreur MongoDB:', err);
  process.exit(1);
});

// Middleware principal
bot.use(async (ctx, next) => {
  try {
    // Logging des activités
    console.log(`[Update] ${ctx.updateType} from ${ctx.from?.id}`);
    
    // Vérification admin
    ctx.isAdmin = String(ctx.from?.id) === ADMIN_ID;
    
    await next();
  } catch (error) {
    console.error('❌ Middleware Error:', error);
    if (error.code === 403) {
      await User.deleteOne({ id: ctx.from?.id });
    }
  }
});

// Gestion des commandes utilisateur
bot.start(async (ctx) => {
  const userData = ctx.message.from;
  const referrerId = ctx.startPayload;

  await User.findOneAndUpdate(
    { id: userData.id },
    {
      $setOnInsert: {
        username: userData.username,
        referrer_id: referrerId,
        balance: 0,
        tickets: 0,
        invited_count: 0
      }
    },
    { upsert: true, new: true }
  );

  await ctx.replyWithMarkdown(`💰 *Bienvenue sur CashXEliteBot* !\n\n` +
    `🔸 Gagnez de l'argent en invitant des amis\n` +
    `🔸 Retrait minimum: 10 000 FCFA\n\n` +
    `📢 Rejoignez nos canaux:`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Canal Officiel', url: 't.me/cashxelite' }],
        [{ text: '✅ Vérifier abonnement', callback_data: 'verify_channels' }]
      ]
    }
  });
});

// Vérification des canaux
bot.action('verify_channels', async (ctx) => {
  const userId = ctx.from.id;
  const isSubscribed = await checkSubscriptions(userId);

  if (isSubscribed) {
    await User.updateOne({ id: userId }, { joined_channels: true });
    await ctx.editMessageText('✅ Accès autorisé ! Choisissez une option:', {
      reply_markup: {
        keyboard: [
          ['💰 Mon Compte', '📢 Inviter'],
          ['🎰 Jouer', '💸 Retrait'],
          ['📞 Support', '🎁 Tombola']
        ],
        resize_keyboard: true
      }
    });
    
    // Attribution récompense parrain
    const user = await User.findOne({ id: userId });
    if (user.referrer_id) {
      await User.updateOne(
        { id: user.referrer_id },
        { $inc: { invited_count: 1, tickets: 1 } }
      );
      await updateUserBalance(user.referrer_id);
    }
  } else {
    await ctx.reply('❌ Veuillez rejoindre tous les canaux');
  }
});

// Commandes du menu principal
const mainCommands = {
  '💰 Mon Compte': async (ctx) => {
    const user = await User.findOne({ id: ctx.from.id });
    const msg = `💵 Solde: ${user.balance} FCFA\n` +
                `👥 Invités: ${user.invited_count}\n` +
                `🎟 Tickets: ${user.tickets}`;
    await ctx.reply(msg);
  },
  
  '📢 Inviter': async (ctx) => {
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    await ctx.replyWithMarkdown(`🎯 *Programme de parrainage*\n\n` +
      `Invitez des amis avec ce lien:\n\`${refLink}\`\n\n` +
      `📈 Récompenses:\n` +
      `1-10 invites: 200 FCFA/invite\n` +
      `10-20 invites: 300 FCFA/invite\n` +
      `20+ invites: 400 FCFA/invite`);
  }
};

// Gestion des messages texte
bot.hears(Object.keys(mainCommands), async (ctx) => {
  await mainCommands[ctx.message.text](ctx);
});

// Système de retrait
bot.hears('💸 Retrait', async (ctx) => {
  const user = await User.findOne({ id: ctx.from.id });
  
  if (user.balance < 10000) {
    return ctx.reply('❌ Solde insuffisant (min 10 000 FCFA)');
  }

  withdrawalProcess.set(user.id, { step: 'method' });
  await ctx.reply('Choisissez un mode de retrait:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Mobile Money', callback_data: 'withdraw_momo' }],
        [{ text: 'Carte Bancaire', callback_data: 'withdraw_card' }]
      ]
    }
  });
});

// Suite dans la partie 2...


// bot.js - Partie 2/2

// Gestion des retraits
bot.action(/withdraw_(momo|card)/, async (ctx) => {
  const userId = ctx.from.id;
  const method = ctx.match[1];
  const session = withdrawalProcess.get(userId);
  
  if (!session || session.step !== 'method') return;
  
  session.method = method === 'momo' ? 'Mobile Money' : 'Carte Bancaire';
  session.step = 'phone';
  await ctx.editMessageText(`📱 Entrez votre numéro ${method === 'momo' ? 'Mobile Money (format: 2250708070707)' : 'de carte'}`);
});

// Collecte des informations de retrait
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = withdrawalProcess.get(userId);
  if (!session) return;

  switch (session.step) {
    case 'phone':
      session.phone = ctx.message.text;
      session.step = 'email';
      await ctx.reply('📧 Entrez votre adresse email:');
      break;
      
    case 'email':
      session.email = ctx.message.text;
      await finalizeWithdrawal(ctx, session);
      withdrawalProcess.delete(userId);
      break;
  }
});

async function finalizeWithdrawal(ctx, session) {
  const user = await User.findOne({ id: ctx.from.id });
  
  // Création de la demande
  const withdrawal = new Withdrawal({
    userId: user.id,
    amount: user.balance,
    method: session.method,
    phone: session.phone,
    email: session.email
  });
  
  await withdrawal.save();
  
  // Réinitialisation solde
  await User.updateOne({ id: user.id }, { $set: { balance: 0 } });
  
  // Notification admin
  await bot.telegram.sendMessage(
    ADMIN_ID,
    `💸 NOUVEAU RETRAIT!\n\n` +
    `👤 Utilisateur: @${ctx.from.username}\n` +
    `💰 Montant: ${user.balance} FCFA\n` +
    `📱 Méthode: ${session.method}\n` +
    `📞 Contact: ${session.phone}\n` +
    `📧 Email: ${session.email}`
  );
  
  await ctx.reply('✅ Demande enregistrée! Traitement sous 24h.');
}

// Système Tombola
bot.hears('🎁 Tombola', async (ctx) => {
  const user = await User.findOne({ id: ctx.from.id });
  await ctx.reply(
    `🎉 VOS TICKETS: ${user.tickets}\n\n` +
    `1 ticket = 1 invitation\n` +
    `Tirage tous les dimanches à 20h!`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🎰 Participer (5 tickets)', 'play_tombola')]
    ])
  );
});

bot.action('play_tombola', async (ctx) => {
  const user = await User.findOne({ id: ctx.from.id });
  
  if (user.tickets < 5) {
    return ctx.answerCbQuery('❌ Tickets insuffisants!');
  }
  
  await User.updateOne({ id: user.id }, { $inc: { tickets: -5 } });
  const win = Math.random() < 0.15; // 15% de chance
  
  if (win) {
    await ctx.answerCbQuery('🎉 Vous gagnez 5000 FCFA!');
    await User.updateOne({ id: user.id }, { $inc: { balance: 5000 } });
  } else {
    await ctx.answerCbQuery('❌ Pas de gain cette fois...');
  }
});

// Système de broadcast admin
bot.command('ads', async (ctx) => {
  if (!ctx.isAdmin) return;
  
  const userCount = await User.countDocuments();
  adminSessions.set(ctx.from.id, {
    stage: 'awaiting_content',
    stats: { total: userCount, sent: 0, failed: 0 }
  });
  
  await ctx.reply(`📢 Broadcast prêt pour ${userCount} users. Envoyez le contenu:`);
});

// Gestion du contenu média
bot.on(['photo', 'video', 'document', 'audio'], async (ctx) => {
  const session = adminSessions.get(ctx.from.id);
  if (!session || session.stage !== 'awaiting_content') return;
  
  session.content = {
    type: ctx.update.message.photo ? 'photo' : 
          ctx.update.message.video ? 'video' :
          ctx.update.message.document ? 'document' : 'audio',
    file_id: ctx.message[ctx.updateType].file_id,
    caption: ctx.message.caption || ''
  };
  
  session.stage = 'confirm';
  await ctx.reply('Confirmer la diffusion?', 
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Lancer (irréversible)', 'confirm_broadcast')],
      [Markup.button.callback('❌ Annuler', 'cancel_broadcast')]
    ])
  );
});

// Confirmation broadcast
bot.action('confirm_broadcast', async (ctx) => {
  const session = adminSessions.get(ctx.from.id);
  if (!session || !session.content) return;
  
  const statusMsg = await ctx.editMessageText('🔄 Démarrage... 0%');
  const users = await User.find().select('id');
  
  // Diffusion avec contrôle de concurrence
  let processed = 0;
  const startTime = Date.now();
  
  const sendPromises = users.map(user => 
    broadcastConcurrency(async () => {
      try {
        await sendMedia(user.id, session.content);
        session.stats.sent++;
      } catch (err) {
        session.stats.failed++;
      }
      
      processed++;
      if (processed % 50 === 0) {
        await updateBroadcastStatus(ctx, statusMsg, session, startTime);
      }
    })
  );
  
  await Promise.all(sendPromises);
  await updateBroadcastStatus(ctx, statusMsg, session, startTime, true);
  adminSessions.delete(ctx.from.id);
});

// Fonctions utilitaires
async function sendMedia(userId, content) {
  try {
    const method = `send${content.type.charAt(0).toUpperCase() + content.type.slice(1)}`;
    await bot.telegram[method](userId, content.file_id, { caption: content.caption });
  } catch (err) {
    if (err.response.error_code === 403) {
      await User.deleteOne({ id: userId });
    }
    throw err;
  }
}

async function updateBroadcastStatus(ctx, msg, session, startTime, final = false) {
  const progress = ((session.stats.sent + session.stats.failed) / session.stats.total * 100).toFixed(1);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  const text = final ? 
    `✅ Diffusion terminée!\n` +
    `📩 Envoyés: ${session.stats.sent}\n` +
    `❌ Échecs: ${session.stats.failed}\n` +
    `⏱ Temps: ${elapsed}s` :
    
    `📤 En cours... ${progress}%\n` +
    `✅ ${session.stats.sent} | ❌ ${session.stats.failed}\n` +
    `⏱ ${elapsed}s | 🚀 ${((session.stats.sent + session.stats.failed) / elapsed).toFixed(1)} msg/s`;
  
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    msg.message_id,
    null,
    text
  );
}

// Gestion erreurs
process.on('unhandledRejection', error => {
  console.error('⚠️ Unhandled Rejection:', error);
});

// Démarrage
bot.launch().then(() => {
  console.log('🚀 Bot opérationnel');
  // Serveur keep-alive
  require('http').createServer((req, res) => res.end('Bot actif')).listen(3000);
});
