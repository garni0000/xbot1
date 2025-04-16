// index.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const Bottleneck = require('bottleneck');
const { User, Withdrawal } = require('./database'); // Modèle Mongoose (ou autre ORM)

// Récupérer les variables d'environnement
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID; // Doit être une chaîne (ex: "123456789")
const bot = new Telegraf(BOT_TOKEN);
const withdrawalProcess = new Map();

// --- Partie EXISTANTE du bot ---

// Middleware de débogage et gestion d'erreurs
bot.use(async (ctx, next) => {
  try {
    console.log(`Update reçu: ${JSON.stringify(ctx.update)}`);
    await next();
  } catch (error) {
    if (error.response?.error_code === 403 && error.response?.description.includes('blocked by the user')) {
      console.log(`⚠️ Utilisateur ${ctx.from?.id} a bloqué le bot. Suppression de l'utilisateur.`);
      await User.deleteOne({ id: ctx.from?.id });
    } else {
      console.error('❌ Erreur middleware:', error);
    }
  }
});

// Fonction utilitaire pour envoyer un message avec gestion d'erreur
async function sendMessage(chatId, text, options = {}) {
  try {
    await bot.telegram.sendMessage(chatId, text, options);
  } catch (err) {
    if (err.response && err.response.error_code === 403) {
      console.log(`⚠️ Utilisateur ${chatId} a bloqué le bot. Suppression de l'utilisateur de la base de données.`);
      await User.deleteOne({ id: chatId });
    } else {
      console.error(`❌ Erreur lors de l'envoi d'un message à ${chatId} :`, err);
    }
  }
}

// Vérifie si l'utilisateur est abonné aux deux canaux
async function isUserInChannels(userId) {
  try {
    const member1 = await bot.telegram.getChatMember('-1002017559099', userId);
    const member2 = await bot.telegram.getChatMember('-1002191790432', userId);
    return ['member', 'administrator', 'creator'].includes(member1.status) &&
           ['member', 'administrator', 'creator'].includes(member2.status);
  } catch (err) {
    console.error('❌ Erreur vérification canaux:', err);
    return false;
  }
}

// Enregistre l'utilisateur sans attribuer immédiatement la récompense au parrain
async function registerUser(userId, username, referrerId) {
  try {
    let user = await User.findOne({ id: userId });
    if (!user) {
      user = await User.create({ id: userId, username, referrer_id: referrerId, joined_channels: false });
      console.log(`✅ Utilisateur ${userId} enregistré`);
    }
  } catch (err) {
    console.error('❌ Erreur enregistrement utilisateur:', err);
  }
}

// Met à jour le solde de l'utilisateur selon le nombre d'invitations
async function updateUserBalance(userId) {
  const user = await User.findOne({ id: userId });
  if (user) {
    let bonus = 200;
    if (user.invited_count >= 10) {
      bonus = 300;
    } else if (user.invited_count >= 20) {
      bonus = 400;
    }
    await User.updateOne({ id: userId }, { balance: user.invited_count * bonus });
  }
}

// Notifie le parrain lors d'une inscription validée via son lien
async function notifyReferrer(referrerId, newUserId) {
  try {
    await sendMessage(referrerId, `🎉 Un nouvel utilisateur (${newUserId}) s'est inscrit via votre lien de parrainage !`);
  } catch (err) {
    console.error('❌ Erreur notification parrain:', err);
  }
}

// Commande /start
bot.start(async (ctx) => {
  const userId = ctx.message.from.id;
  const username = ctx.message.from.username || 'Utilisateur';
  const referrerId = ctx.startPayload ? parseInt(ctx.startPayload) : null;
  await registerUser(userId, username, referrerId);
  await sendMessage(userId, `𝐁𝐢𝐞𝐧𝐯𝐞𝐧𝐮𝐞 𝐬𝐮𝐫 𝐂𝐚𝐬𝐡𝐗𝐞𝐥𝐢𝐭𝐞𝐛𝐨𝐭 !\nRejoignez les canaux pour débloquer l'accès :`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Canal 1', url: 'https://t.me/+z73xstC898s4N2Zk' }],
        [{ text: 'Canal 2', url: 'https://t.me/+z7Ri0edvkbw4MDM0' }],
        [{ text: 'Canal 3', url: 'https://t.me/+rSXyxHTwcN5lNWE0' }],
        [{ text: '✅ Vérifier', callback_data: 'check' }]
      ]
    }
  });
});

// Vérification d'abonnement et récompense
bot.action('check', async (ctx) => {
  const userId = ctx.from.id;
  const user = await User.findOne({ id: userId });
  if (!user) return ctx.reply('❌ Utilisateur non trouvé.');
  if (await isUserInChannels(userId)) {
    if (!user.joined_channels) {
      await User.updateOne({ id: userId }, { joined_channels: true });
      if (user.referrer_id) {
        await User.updateOne({ id: user.referrer_id }, { $inc: { invited_count: 1, tickets: 1 } });
        await updateUserBalance(user.referrer_id);
        await notifyReferrer(user.referrer_id, userId);
      }
    }
    let keyboard = [
      [{ text: 'Mon compte 💳' }, { text: 'Inviter📢' }],
      [{ text: 'Play to win 🎰' }, { text: 'Withdrawal💸' }],
      [{ text: 'Support📩' }, { text: 'Tuto 📖' }],
      [{ text: 'Tombola 🎟️' }]
    ];
    if (String(userId) === ADMIN_ID) {
      keyboard.push([{ text: 'Admin' }]);
    }
    ctx.reply('✅ Accès autorisé !', {
      reply_markup: {
        keyboard: keyboard,
        resize_keyboard: true
      }
    });
  } else {
    ctx.reply('❌ Rejoignez les canaux d\'abord !');
  }
});

// Gestion des commandes textuelles de base
bot.hears(
  ['Mon compte 💳', 'Inviter📢', 'Play to win 🎰', 'Withdrawal💸', 'Support📩', 'Tuto 📖', 'Tombola 🎟️', 'Admin'],
  async (ctx) => {
    const userId = ctx.message.from.id;
    const user = await User.findOne({ id: userId });
    if (!user) return ctx.reply('❌ Utilisateur non trouvé.');
    switch (ctx.message.text) {
      case 'Mon compte 💳':
        return ctx.reply(`💰 Solde: ${user.balance} Fcfa\n📈 Invités: ${user.invited_count}\n🎟️ Tickets: ${user.tickets}`);
      case 'Inviter📢':
        return ctx.reply(`❝𝙏𝙪 𝙜𝙖𝙜𝙣𝙚𝙧𝙖𝙨 𝟮𝟬𝟬 𝙁𝘾𝙁𝘼 𝙥𝙤𝙪𝙧 𝙘𝙝𝙖𝙦𝙪𝙚 𝙥𝙚𝙧𝙨𝙤𝙣𝙣𝙚 𝙦𝙪𝙚 𝙩𝙪 𝙞𝙣𝙫𝙞𝙩𝙚𝙨.❞ \n\n🔗 Lien de parrainage : https://t.me/cashXelitebot?start=${userId}\n\n❝🔹 𝐈𝐧𝐯𝐢𝐭𝐞 𝐭𝐞𝐬 𝐚𝐦𝐢𝐬 𝐞𝐭 𝐫𝐞ç𝐨𝐢𝐬 𝐮𝐧𝐞 𝐫é𝐜𝐨𝐦𝐩𝐞𝐧𝐬𝐞.\n\n✅ 1 à 10 amis → 200 Fcfa par invitation\n✅ 10 à 20 amis → 300 Fcfa par invitation\n✅ 20 amis ou plus → 400 Fcfa par invitation\n📲 Plus tu invites, plus tu gagnes ! 🚀🔥❞`);
      case 'Play to win 🎰':
        return ctx.reply(`🎮 Jouer ici : https://t.me/cashXelitebot/cash`);
      case 'Withdrawal💸':
        if (user.balance >= 10000) {
          withdrawalProcess.set(userId, { step: 'awaiting_payment_method' });
          return ctx.reply('💸 Méthode de paiement :');
        } else {
          return ctx.reply('❌ Minimum 10 000 Fcfa');
        }
      case 'Support📩':
        return ctx.reply('📩 Contact : @Medatt00');
      case 'Tuto 📖':
        return ctx.reply('📖 Guide : https://t.me/gxgcaca');
      case 'Tombola 🎟️':
        return ctx.reply('🎟️ 1 invitation = 1 ticket');
      case 'Admin':
        if (String(ctx.message.from.id) === ADMIN_ID) {
          await ctx.replyWithMarkdown('🔧 *Menu Admin*', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '👥 Total Utilisateurs', callback_data: 'admin_users' }],
                [{ text: '📅 Utilisateurs/mois', callback_data: 'admin_month' }],
                [{ text: '📢 Diffuser message', callback_data: 'admin_broadcast' }],
                [{ text: '📣 Publicités (Ads)', callback_data: 'admin_ads' }]
              ]
            }
          });
        } else {
          return ctx.reply('❌ Accès refusé. Vous n\'êtes pas administrateur.');
        }
        break;
    }
  }
});

// Commande /admin (alternative via commande)
bot.command('admin', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) {
    return ctx.reply('❌ Accès refusé. Vous n\'êtes pas administrateur.');
  }
  await ctx.replyWithMarkdown('🔧 *Menu Admin*', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👥 Total Utilisateurs', callback_data: 'admin_users' }],
        [{ text: '📅 Utilisateurs/mois', callback_data: 'admin_month' }],
        [{ text: '📢 Diffuser message', callback_data: 'admin_broadcast' }],
        [{ text: '📣 Publicités (Ads)', callback_data: 'admin_ads' }]
      ]
    }
  });
});

// Processus de retrait via messages texte
bot.on('text', async (ctx) => {
  const userId = ctx.message.from.id;
  const userState = withdrawalProcess.get(userId);
  if (userState) {
    const user = await User.findOne({ id: userId });
    if (!user) {
      withdrawalProcess.delete(userId);
      return ctx.reply('❌ Utilisateur non trouvé');
    }
    switch (userState.step) {
      case 'awaiting_payment_method':
        userState.paymentMethod = ctx.message.text;
        userState.step = 'awaiting_country';
        await ctx.reply('🌍 Pays de résidence :');
        break;
      case 'awaiting_country':
        userState.country = ctx.message.text;
        userState.step = 'awaiting_phone';
        await ctx.reply('📞 Téléphone (avec indicatif) :');
        break;
      case 'awaiting_phone':
        userState.phone = ctx.message.text;
        userState.step = 'awaiting_email';
        await ctx.reply('📧 Email :');
        break;
      case 'awaiting_email':
        userState.email = ctx.message.text;
        const withdrawal = new Withdrawal({
          userId,
          amount: user.balance,
          ...userState
        });
        await withdrawal.save();
        await ctx.reply('✅ Demande enregistrée !');
        await sendMessage(ADMIN_ID,
          `💸 Nouveau retrait\n\n` +
          `👤 Utilisateur: @${ctx.from.username || 'N/A'}\n` +
          `💰 Montant: ${user.balance} Fcfa\n` +
          `📱 Méthode: ${userState.paymentMethod}\n` +
          `🌍 Pays: ${userState.country}\n` +
          `📞 Tél: ${userState.phone}\n` +
          `📧 Email: ${userState.email}`
        );
        withdrawalProcess.delete(userId);
        break;
    }
  }
});

// Gestion des callbacks admin pour statistiques et diffusion (diffusion via copyMessage)
const broadcastState = new Map();
bot.on('callback_query', async (ctx) => {
  const userId = String(ctx.from.id);
  const data = ctx.callbackQuery.data;
  if (userId === ADMIN_ID) {
    try {
      if (data === 'admin_users') {
        const count = await User.countDocuments();
        await ctx.replyWithMarkdown(`👥 *Total utilisateurs:* ${count}`);
      } else if (data === 'admin_month') {
        const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const count = await User.countDocuments({ createdAt: { $gte: start } });
        await ctx.replyWithMarkdown(`📅 *Ce mois-ci:* ${count}`);
      } else if (data === 'admin_broadcast') {
        // Lancement d'une diffusion (mode message cloné)
        broadcastState.set(userId, { step: 'awaiting_message' });
        await ctx.reply('📤 Envoyez le message à diffuser :');
      } else if (data === 'admin_ads') {
        // Activation du mode publicités (Ads)
        adsState.active = false;
        adsState.pendingMessage = null;
        await ctx.reply('📨 Envoyez le message publicitaire à diffuser via /ads');
      }
    } catch (error) {
      console.error('Erreur admin:', error);
      await ctx.reply('❌ Erreur de traitement');
    }
  }
  await ctx.answerCbQuery();
});

// --- Nouvelle fonctionnalité : Diffusion des publicités avec la commande /ads ---
// On utilise Bottleneck pour limiter le débit
const adsLimiter = new Bottleneck({
  maxConcurrent: 30,
  minTime: 50,
  reservoir: 30,
  reservoirRefreshInterval: 1000,
  reservoirRefreshAmount: 30
});

// État global pour la diffusion des publicités
let adsState = {
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

// Commande /ads pour lancer la diffusion des pubs (accessible uniquement à l'admin)
bot.command('ads', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  adsState.pendingMessage = null;
  await ctx.reply("📨 Envoyez le message publicitaire à diffuser (texte, photo, vidéo, etc.)");
});

// Réception du message publicitaire (uniquement admin)
bot.on('message', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  // Si une diffusion Ads est en cours ou déjà préparée, on n'interfère pas avec les autres messages
  if (!adsState.pendingMessage && ctx.message && !ctx.message.text.startsWith('/')) {
    adsState.pendingMessage = ctx.message;
    const total = await User.countDocuments();
    adsState.totalUsers = total;
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅ Confirmer', 'confirm_ads'),
      Markup.button.callback('❌ Annuler', 'cancel_ads')
    ]);
    await ctx.reply(
      `⚠️ Confirmez la diffusion de la pub à ${total} utilisateurs\n` +
      `Type: ${getMessageType(ctx.message)}\n` +
      `Durée estimée: ${estimateBroadcastDuration(total)}`,
      keyboard
    );
  }
});

// Annulation de la diffusion publicitaire
bot.action('cancel_ads', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('❌ Diffusion publicitaire annulée');
  resetAdsState();
});

// Confirmation et lancement de la diffusion publicitaire
bot.action('confirm_ads', async (ctx) => {
  if (adsState.active || !adsState.pendingMessage) return;
  adsState.active = true;
  adsState.startTime = Date.now();
  adsState.statusMessageId = ctx.callbackQuery.message.message_id;
  try {
    await ctx.answerCbQuery('🚀 Début de la diffusion publicitaire...');
    await updateAdsProgress(ctx);
    // Mise à jour périodique des stats
    adsState.statsInterval = setInterval(() => updateAdsProgress(ctx), 3000);
    // Récupération de tous les utilisateurs et envoi du message publicitaire
    const users = await User.find({}, 'id').lean();
    const tasks = users.map(user =>
      adsLimiter.schedule(() =>
        sendAdsWithRetry(user.id, adsState.pendingMessage)
          .then(() => { adsState.success++; })
          .catch(() => { adsState.failed++; })
          .then(() => { adsState.processed++; })
      )
    );
    await Promise.allSettled(tasks);
    await finalizeAds(ctx);
  } catch (error) {
    console.error('Erreur publicitaire critique:', error);
    await ctx.telegram.sendMessage(ctx.from.id, `❌ Erreur de diffusion pub : ${error.message}`);
  } finally {
    resetAdsState();
  }
});

// Envoi avec réessai pour la diffusion publicitaire
async function sendAdsWithRetry(userId, message, attempt = 1) {
  try {
    await sendAdsMessage(userId, message);
  } catch (error) {
    if (attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
      return sendAdsWithRetry(userId, message, attempt + 1);
    }
    console.error(`❌ Échec d'envoi pub à ${userId} après ${attempt} tentatives.`);
    throw error;
  }
}

// Envoi du message publicitaire (selon type)
async function sendAdsMessage(userId, message) {
  try {
    if (message.text) {
      await bot.telegram.sendMessage(userId, message.text);
    } else if (message.photo) {
      await bot.telegram.sendPhoto(userId, message.photo[0].file_id, { caption: message.caption || '' });
    } else if (message.video) {
      await bot.telegram.sendVideo(userId, message.video.file_id, { caption: message.caption || '' });
    }
  } catch (error) {
    error.userId = userId;
    throw error;
  }
}

// Mise à jour des statistiques pour la diffusion publicitaire
async function updateAdsProgress(ctx) {
  const elapsed = Math.floor((Date.now() - adsState.startTime) / 1000);
  const progress = (adsState.processed / adsState.totalUsers) * 100;
  const speed = Math.round(adsState.processed / elapsed) || 0;
  const statsMessage =
`⏳ Progression : ${Math.round(progress)}% (${adsState.processed}/${adsState.totalUsers})
⏱ Temps écoulé : ${elapsed}s
📤 Vitesse : ${speed} msg/s
✅ Réussis : ${adsState.success}
❌ Échecs : ${adsState.failed}`;
  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      adsState.statusMessageId,
      null,
      statsMessage
    );
  } catch (error) {
    console.error('Erreur de mise à jour Ads:', error.message);
  }
}

// Finalisation de la diffusion publicitaire
async function finalizeAds(ctx) {
  clearInterval(adsState.statsInterval);
  const totalTime = Math.floor((Date.now() - adsState.startTime) / 1000);
  const finalMessage =
`🏁 Diffusion pub terminée !
Durée totale : ${totalTime}s
Utilisateurs atteints : ${adsState.success}/${adsState.totalUsers}
Taux de succès : ${((adsState.success / adsState.totalUsers) * 100).toFixed(1)}%`;
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    adsState.statusMessageId,
    null,
    finalMessage
  );
}

// Réinitialisation de l'état publicitaire
function resetAdsState() {
  adsState = {
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

// Helper : détermine le type de message (utilisé pour la diffusion et estimation)
function getMessageType(message) {
  if (message.text) return 'text';
  if (message.photo) return 'photo';
  if (message.video) return 'video';
  return 'unknown';
}

// Helper : estime la durée de diffusion (en fonction du nombre d'utilisateurs)
function estimateBroadcastDuration(userCount) {
  const seconds = Math.round((userCount * 50) / 1000); // 50ms par message
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

// --- Gestion globale des erreurs ---
bot.catch((err, ctx) => {
  console.error(`❌ Erreur pour ${ctx.updateType}:`, err);
});

// Démarrage du bot et création du serveur HTTP
bot.launch()
  .then(() => console.log('🚀 Bot démarré !'))
  .catch(err => {
    console.error('❌ Erreur de démarrage:', err);
    process.exit(1);
  });

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot en ligne');
}).listen(8080);
