const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const pLimit = require('p-limit');
const { User, Withdrawal } = require('./database');
const dotenv = require('dotenv');

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
    console.log(`[Update] ${ctx.updateType} de ${ctx.from?.id}`);
    ctx.isAdmin = String(ctx.from?.id) === ADMIN_ID;
    await next();
  } catch (error) {
    console.error('❌ Middleware Error:', error);
    if (error.code === 403) {
      await User.deleteOne({ id: ctx.from?.id });
    }
  }
});

// Commande /start
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
  // Suite dans partie 2...// ... Suite de la Partie 1

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
      await ctx.telegram.sendMessage(
        user.referrer_id,
        `🎉 Nouveau filleul ! @${user.username} a rejoint via votre lien`
      );
    }
  } else {
    await ctx.replyWithMarkdown('❌ *Rejoignez tous les canaux requis*');
  }
});

// Commandes principales
const mainCommands = {
  '💰 Mon Compte': async (ctx) => {
    const user = await User.findOne({ id: ctx.from.id });
    const balanceInfo = `💶 *Solde* : ${user.balance} FCFA\n` +
                       `👥 *Filleuls* : ${user.invited_count}\n` +
                       `🎫 *Tickets* : ${user.tickets}`;
    await ctx.replyWithMarkdown(balanceInfo);
  },

  '📢 Inviter': async (ctx) => {
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
    const message = `*📣 Programme de Parrainage*\n\n` +
                   `Gagnez 200-400 FCFA par invitation!\n\n` +
                   `🔗 Lien unique : \`${refLink}\`\n\n` +
                   `🎯 Paliers :\n` +
                   `- 1-10 invites : 200 FCFA\n` +
                   `- 11-20 invites : 300 FCFA\n` +
                   `- 21+ invites : 400 FCFA`;
    await ctx.replyWithMarkdown(message);
  },

  '💸 Retrait': async (ctx) => {
    const user = await User.findOne({ id: ctx.from.id });
    
    if (user.balance < 10000) {
      return ctx.replyWithMarkdown('❌ *Minimum 10 000 FCFA requis*');
    }

    withdrawalProcess.set(user.id, { 
      step: 'method',
      userBalance: user.balance 
    });

    await ctx.reply('💳 Choisissez votre méthode :', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('📱 Mobile Money', 'withdraw_momo')],
        [Markup.button.callback('💳 Carte Bancaire', 'withdraw_card')]
      ])
    });
  }
};

// Gestion des actions de retrait
bot.action(/withdraw_(momo|card)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = withdrawalProcess.get(userId);
  
  if (!session || session.step !== 'method') return;
  
  session.method = ctx.match[1] === 'momo' ? 'Mobile Money' : 'Carte Bancaire';
  session.step = 'phone_input';
  
  await ctx.editMessageText(
    `📱 Entrez votre numéro ${session.method === 'Mobile Money' ? 
    'Mobile Money (ex: +2250707070707)' : 
    'de carte bancaire'}`
  );
});

// Capture des informations de retrait
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = withdrawalProcess.get(userId);
  
  if (!session) return;

  switch (session.step) {
    case 'phone_input':
      session.phone = ctx.message.text;
      session.step = 'email_input';
      await ctx.reply('📧 Entrez votre adresse email :');
      break;
      
    case 'email_input':
      session.email = ctx.message.text;
      await processWithdrawal(ctx, session);
      withdrawalProcess.delete(userId);
      break;
  }
});

// ... La suite dans la Partie 3 ...// ... Suite de la Partie 2

// Finalisation du retrait
async function processWithdrawal(ctx, session) {
  try {
    const user = await User.findOne({ id: ctx.from.id });
    
    // Création de la demande
    const withdrawal = new Withdrawal({
      userId: user.id,
      amount: user.balance,
      method: session.method,
      phone: session.phone,
      email: session.email,
      status: 'pending'
    });

    await withdrawal.save();
    
    // Réinitialisation du solde
    await User.updateOne({ id: user.id }, { balance: 0 });

    // Notification admin
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `⚠️ *NOUVEAU RETRAIT* ⚠️\n\n` +
      `👤 Utilisateur: @${ctx.from.username}\n` +
      `📱 Méthode: ${session.method}\n` +
      `💸 Montant: ${user.balance} FCFA\n` +
      `📞 Contact: ${session.phone}\n` +
      `📧 Email: ${session.email}`,
      { parse_mode: 'Markdown' }
    );

    await ctx.replyWithMarkdown(
      `✅ Demande de *${user.balance} FCFA* enregistrée !\n` +
      `Traitement sous 24 heures maximum.`
    );

  } catch (error) {
    console.error('❌ Erreur retrait:', error);
    await ctx.reply('❌ Erreur lors du traitement');
  }
}

// Système Admin
bot.command('ads', async (ctx) => {
  if (!ctx.isAdmin) return;

  const userCount = await User.countDocuments();
  adminSessions.set(ctx.from.id, {
    stage: 'awaiting_content',
    stats: { total: userCount, sent: 0, failed: 0 }
  });

  await ctx.replyWithMarkdown(
    `📢 *Mode Diffusion Admin*\n\n` +
    `Prêt à envoyer à *${userCount}* utilisateurs\n\n` +
    `Envoyez le contenu (texte/photo/vidéo)...`
  );
});

// Gestion des médias pour broadcast
bot.on(['photo', 'video', 'document'], async (ctx) => {
  const session = adminSessions.get(ctx.from.id);
  if (!session || session.stage !== 'awaiting_content') return;

  // Extraction des infos média
  const content = {
    type: ctx.update.message.photo ? 'photo' : 
          ctx.update.message.video ? 'video' : 'document',
    file_id: ctx.message[ctx.updateType].file_id,
    caption: ctx.message.caption || ''
  };

  session.content = content;
  session.stage = 'confirmation';

  await ctx.reply('Confirmer la diffusion ?', Markup.inlineKeyboard([
    [Markup.button.callback('✅ LANCER (IRRÉVERSIBLE)', 'confirm_broadcast')],
    [Markup.button.callback('❌ ANNULER', 'cancel_broadcast')]
  ]));
});

// Diffusion effective
bot.action('confirm_broadcast', async (ctx) => {
  const session = adminSessions.get(ctx.from.id);
  if (!session?.content) return;

  const statusMsg = await ctx.editMessageText('🚀 Démarrage de la diffusion... 0%');
  const users = await User.find().select('id');
  
  let processed = 0;
  const startTime = Date.now();

  // Traitement parallèle contrôlé
  const promises = users.map(user => 
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

  await Promise.all(promises);
  await updateBroadcastStatus(ctx, statusMsg, session, startTime, true);
  adminSessions.delete(ctx.from.id);
});

// Fonctions utilitaires
async function sendMedia(userId, content) {
  try {
    const method = `send${content.type.charAt(0).toUpperCase() + content.type.slice(1)}`;
    await bot.telegram[method](userId, content.file_id, {
      caption: content.caption,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    if (error.code === 403) { // Utilisateur a bloqué le bot
      await User.deleteOne({ id: userId });
    }
    throw error;
  }
}

async function updateBroadcastStatus(ctx, statusMsg, session, startTime, isFinal = false) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalProcessed = session.stats.sent + session.stats.failed;
  
  const stats = isFinal 
    ? `✅ ${session.stats.sent} | ❌ ${session.stats.failed} | ⏱ ${elapsed}s`
    : `📤 ${Math.round((totalProcessed / session.stats.total) * 100)}% | ` +
      `🚀 ${(totalProcessed / elapsed).toFixed(1)} msg/s`;

  await ctx.telegram.editMessageText(
    ctx.chat.id,
    statusMsg.message_id,
    null,
    `📊 *Statut Diffusion*\n\n${stats}`,
    { parse_mode: 'Markdown' }
  );
}

// Démarrage du bot
bot.launch().then(() => {
  console.log('🤖 Bot en ligne');
  // Serveur minimal pour keep-alive
  require('http').createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot CashXElite actif');
  }).listen(process.env.PORT || 3000);
});

// Gestion des erreurs globales
process.on('unhandledRejection', error => {
  console.error('⚠️ UNHANDLED REJECTION:', error);
});
