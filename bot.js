const { Telegraf, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
// … tes autres imports

const adminSessions = new Map();
let PLimit;

// setup MongoDB
const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const db = client.db('bot_spam');
const usersCollection = db.collection('users');








const http = require('http');
const { User, Withdrawal } = require('./database');



const dotenv = require('dotenv');

// Charger les variables d'environnement depuis .env
dotenv.config();

// Récupérer les variables d'environnement
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

const bot = new Telegraf(BOT_TOKEN); // Utilisation du token depuis .env
const withdrawalProcess = new Map();




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
      // On initialise joined_channels à false pour que la récompense ne soit pas attribuée avant la vérification
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

  await sendMessage(userId, `𝐁𝐢𝐞𝐧𝐯𝐞𝐧𝐮𝐞 𝐬𝐮𝐫 𝐂𝐚𝐬𝐡 𝐗 𝐞𝐥𝐢𝐭𝐞𝐛𝐨𝐭 𝐥𝐞 𝐩𝐥𝐚𝐭𝐟𝐨𝐫𝐦𝐞 𝐪𝐮𝐢 𝐯𝐚𝐬 𝐭𝐞 𝐟𝐚𝐢𝐫𝐞 𝐠𝐚𝐠𝐧𝐞𝐫 𝐝𝐮 𝐜𝐚𝐬𝐡 💴!\n Rejoignez les canaux pour debloquer ton acces:`, {
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


// Vérification de l'abonnement aux canaux et attribution de la récompense si applicable
bot.action('check', async (ctx) => {
  const userId = ctx.from.id;
  const user = await User.findOne({ id: userId });

  if (!user) {
    return ctx.reply('❌ Utilisateur non trouvé.');
  }

  if (await isUserInChannels(userId)) {
    if (!user.joined_channels) {
      await User.updateOne({ id: userId }, { joined_channels: true });
      // Attribution de la récompense au parrain si l'utilisateur possède un referrer
      if (user.referrer_id) {
        await User.updateOne({ id: user.referrer_id }, { $inc: { invited_count: 1, tickets: 1 } });
        await updateUserBalance(user.referrer_id);
        await notifyReferrer(user.referrer_id, userId);
      }
    }

    // Construction du clavier principal
    let keyboard = [
      [{ text: 'Mon compte 💳' }, { text: 'Inviter📢' }],
      [{ text: 'Play to win 🎰' }, { text: 'Withdrawal💸' }],
      [{ text: 'Support📩' }, { text: 'Tuto 📖' }],
      [{ text: 'Tombola 🎟' }]
    ];

    // Bouton Admin visible uniquement pour l'admin
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
  ['Mon compte 💳', 'Inviter📢', 'Play to win 🎰', 'Withdrawal💸', 'Support📩', 'Tuto 📖', 'Tombola 🎟', 'Admin'],
  async (ctx) => {
    const userId = ctx.message.from.id;
    const user = await User.findOne({ id: userId });
    if (!user) return ctx.reply('❌ Utilisateur non trouvé.');

    switch (ctx.message.text) {
      case 'Mon compte 💳':
        return ctx.reply(`💰 Solde: ${user.balance} Fcfa\n📈 Invités: ${user.invited_count}\n🎟 Tickets: ${user.tickets}`);
      case 'Inviter📢':
        return ctx.reply(`❝𝙏𝙪 𝙜𝙖𝙜𝙣𝙚𝙧𝙖𝙨 𝟮𝟬𝟬 𝙁𝘾𝙁𝘼 𝙥𝙤𝙪𝙧 𝙘𝙝𝙖𝙦𝙪𝙚 𝙥𝙚𝙧𝙨𝙤𝙣𝙣𝙚 𝙦𝙪𝙚 𝙩𝙪 𝙞𝙣𝙫𝙞𝙩𝙚𝙨.❞ \n \n 🔗 Lien de parrainage : https://t.me/cashXelitebot?start=${userId} \n \n ❝🔹 𝐈𝐧𝐯𝐢𝐭𝐞 𝐭𝐞𝐬 𝐚𝐦𝐢𝐬 𝐞𝐭 𝐫𝐞ç𝐨𝐢𝐬 𝐮𝐧𝐞 𝐫é𝐜𝐨𝐦𝐩𝐞𝐧𝐬𝐞 :\n \n✅𝟏 à 𝟏𝟎 𝐚𝐦𝐢𝐬 → 𝟐𝟎𝟎 𝐅𝐂𝐅𝐀 𝐩𝐚𝐫 𝐢𝐧𝐯𝐢𝐭𝐚𝐭𝐢𝐨𝐧\n✅ 𝟏𝟎 à 𝟐𝟎 𝐚𝐦𝐢𝐬 → 𝟑𝟎𝟎 𝐅𝐂𝐅𝐀 𝐩𝐚𝐫 𝐢𝐧𝐯𝐢𝐭𝐚𝐭𝐢𝐨𝐧\n✅ 𝟐𝟎 𝐚𝐦𝐢𝐬 𝐨𝐮 𝐩𝐥𝐮𝐬 → 𝟒𝟎𝟎 𝐅𝐂𝐅𝐀 𝐩𝐚𝐫 𝐢𝐧𝐯𝐢𝐭𝐚𝐭𝐢𝐨𝐧 \n 📲 𝐏𝐥𝐮𝐬 𝐭𝐮 𝐢𝐧𝐯𝐢𝐭𝐞𝐬, 𝐩𝐥𝐮𝐬 𝐭𝐮 𝐠𝐚𝐠𝐧𝐞𝐬 ! 🚀🔥❞`);
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
      case 'Tombola 🎟':
        return ctx.reply('🎟 1 invitation = 1 ticket');
      case 'Admin':
        if (String(ctx.message.from.id) === ADMIN_ID) {
          await ctx.replyWithMarkdown('🔧 *Menu Admin*', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '👥 Total Utilisateurs', callback_data: 'admin_users' }],
                [{ text: '📅 Utilisateurs/mois', callback_data: 'admin_month' }],
                [{ text: '📢 Diffuser message', callback_data: 'admin_broadcast' }]
              ]
            }
          });
        } else {
          return ctx.reply('❌ Accès refusé. Vous n\'êtes pas administrateur.');
        }
        break;
    }
  }
);

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
        [{ text: '📢 Diffuser message', callback_data: 'admin_broadcast' }]
      ]
    }
  });
});





















// 👉 Variables globales pour la gestion des sessions et du throttle
const adminSessions = new Map();
let PLimit;

// /ads command handler
bot.command('ads', async (ctx) => {
  // Sécurité : seule l’admin peut lancer
  if (String(ctx.from.id) !== ADMIN_ID) return;
  
  // Nombre total d’utilisateurs
  const totalUsers = await usersCollection.countDocuments();
  
  // On stocke l’état de la session
  adminSessions.set(ctx.from.id, {
    stage: 'awaiting_content',
    total: totalUsers
  });
  
  // On prévient l’admin
  return ctx.reply(
    `Hey bro, tu es sur le point d'envoyer des pubs à ${totalUsers} users. Envoie-moi le contenu (texte, photo, vidéo, audio, document, etc.).`
  );
});

// Capture du contenu (texte, photo, vidéo, audio, document, voice…)
bot.on(['text', 'photo', 'video', 'audio', 'document', 'voice'], async (ctx) => {
  const session = adminSessions.get(ctx.from.id);
  if (!session || session.stage !== 'awaiting_content') return;
  
  // On détermine le type et on stocke file_id + légende si besoin
  let content = { type: 'text', data: ctx.message.text || '' };
  if (ctx.message.photo) {
    const photo = ctx.message.photo.pop();
    content = { type: 'photo', file_id: photo.file_id, caption: ctx.message.caption || '' };
  } else if (ctx.message.video) {
    content = { type: 'video', file_id: ctx.message.video.file_id, caption: ctx.message.caption || '' };
  } else if (ctx.message.audio) {
    content = { type: 'audio', file_id: ctx.message.audio.file_id, caption: ctx.message.caption || '' };
  } else if (ctx.message.voice) {
    content = { type: 'voice', file_id: ctx.message.voice.file_id };
  } else if (ctx.message.document) {
    content = { type: 'document', file_id: ctx.message.document.file_id, caption: ctx.message.caption || '' };
  }
  
  // On passe à l’étape suivante
  session.content = content;
  session.stage = 'awaiting_confirm';
  
  // Prévisualisation succincte
  let preview = '';
  switch (content.type) {
    case 'text':     preview = content.data; break;
    case 'photo':    preview = '📸 Photo';        break;
    case 'video':    preview = '🎥 Vidéo';        break;
    case 'audio':    preview = '🎵 Audio';        break;
    case 'voice':    preview = '🎙️ Voice';       break;
    case 'document': preview = '📄 Document';     break;
  }
  
  return ctx.reply(
    `Prévisualisation : ${preview}\n\nVoulez-vous confirmer la diffusion ?`,
    Markup.inlineKeyboard([
      Markup.button.callback('✅ Oui', 'ads_confirm'),
      Markup.button.callback('❌ Non', 'ads_cancel')
    ])
  );
});

// Confirmation de l’admin
bot.action('ads_confirm', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery();
  const session = adminSessions.get(ctx.from.id);
  if (!session || session.stage !== 'awaiting_confirm') return ctx.answerCbQuery();
  
  // On bascule en mode broadcast
  await ctx.editMessageText('🔄 Lancement de la diffusion...');
  session.stage = 'broadcasting';
  
  // Lancement asynchrone de la diffusion
  broadcastAds(ctx, session).catch(console.error);
  return ctx.answerCbQuery();
});

// Annulation
bot.action('ads_cancel', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return ctx.answerCbQuery();
  adminSessions.delete(ctx.from.id);
  await ctx.editMessageText('❌ Diffusion annulée.');
  return ctx.answerCbQuery();
});

// Fonction de broadcast avec stats en temps réel
async function broadcastAds(ctx, session) {
  const { total, content } = session;
  if (!PLimit) {
    PLimit = (await import('p-limit')).default;
  }
  const limit = PLimit(20); // max 20 envois concurrents
  let success = 0;
  let failed = 0;
  const start = Date.now();
  
  // Message de statut
  const statusMsg = await ctx.reply(`✅: 0 | ❌: 0 | 0 msg/s`);
  
  // On parcourt les users en streaming
  const cursor = usersCollection.find({}, { projection: { id: 1 } });
  const tasks = [];
  let sent = 0;
  
  while (await cursor.hasNext()) {
    const user = await cursor.next();
    tasks.push(limit(async () => {
      try {
        // Envoi selon le type
        switch (content.type) {
          case 'text':
            await bot.telegram.sendMessage(user.id, content.data);
            break;
          case 'photo':
            await bot.telegram.sendPhoto(user.id, content.file_id, { caption: content.caption });
            break;
          case 'video':
            await bot.telegram.sendVideo(user.id, content.file_id, { caption: content.caption });
            break;
          case 'audio':
            await bot.telegram.sendAudio(user.id, content.file_id, { caption: content.caption });
            break;
          case 'voice':
            await bot.telegram.sendVoice(user.id, content.file_id);
            break;
          case 'document':
            await bot.telegram.sendDocument(user.id, content.file_id, { caption: content.caption });
            break;
        }
        success++;
      } catch (err) {
        failed++;
      } finally {
        sent++;
        // Mise à jour toutes les 50 itérations
        if (sent % 50 === 0) {
          const elapsed = (Date.now() - start) / 1000;
          const rate = (sent / elapsed).toFixed(2);
          try {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              null,
              `✅: ${success} | ❌: ${failed} | ${rate} msg/s`
            );
          } catch (_) {}
        }
      }
    }));
  }
  
  // On attend tout
  await Promise.all(tasks);
  
  // Bilan final
  const totalTime = ((Date.now() - start) / 1000).toFixed(2);
  await ctx.telegram.editMessageText(
    ctx.chat.id,
    statusMsg.message_id,
    null,
    `🎉 Terminé ! Total ✅: ${success} | ❌: ${failed} | en ${totalTime}s`
  );
  
  // On nettoie la session
  adminSessions.delete(ctx.from.id);
}









// Processus de retrait via messages texte
bot.on('text', async (ctx) => {
  const userId = ctx.message.from.id;
  const userState = withdrawalProcess.get(userId);
  if (!userState) return;

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
      await sendMessage(
        ADMIN_ID,
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
});

// Gestion des callbacks admin pour statistiques et diffusion
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
        broadcastState.set(userId, { step: 'awaiting_message' });
        await ctx.reply('📤 Envoyez le message à diffuser :');
      } else if (data === 'broadcast_cancel') {
        broadcastState.delete(userId);
        await ctx.reply('Diffusion annulée.');
      } else if (data.startsWith('broadcast_')) {
        const [_, chatId, messageId] = data.split('_');
        const users = await User.find().select('id');
        let success = 0;
        await ctx.reply(`Début diffusion à ${users.length} utilisateurs...`);
        for (const user of users) {
          try {
            await bot.telegram.copyMessage(user.id, chatId, messageId);
            success++;
          } catch (error) {
            console.error(`Échec à ${user.id}:`, error.message);
          }
        }
        await ctx.reply(`✅ Diffusion terminée : ${success}/${users.length} réussis`);
      }
    } catch (error) {
      console.error('Erreur admin:', error);
      await ctx.reply('❌ Erreur de traitement');
    }
  }
  await ctx.answerCbQuery();
});

// Gestion globale des erreurs
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
