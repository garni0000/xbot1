const { Telegraf } = require('telegraf');
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

  await sendMessage(userId, `𝐁𝐢𝐞𝐧𝐯𝐞𝐧𝐮𝐞 𝐬𝐮𝐫 𝐂𝐚𝐬𝐡𝐗𝐞𝐥𝐢𝐭𝐞𝐛𝐨𝐭 𝐥𝐞 𝐩𝐥𝐚𝐭𝐟𝐨𝐫𝐦𝐞 𝐪𝐮𝐢 𝐯𝐚𝐬 𝐭𝐞 𝐟𝐚𝐢𝐫𝐞 𝐠𝐚𝐠𝐧𝐞𝐫 𝐝𝐮 𝐜𝐚𝐬𝐡 💴!\n Rejoignez les canaux pour debloquer ton acces:`, {
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
      [{ text: 'Tombola 🎟️' }]
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
  ['Mon compte 💳', 'Inviter📢', 'Play to win 🎰', 'Withdrawal💸', 'Support📩', 'Tuto 📖', 'Tombola 🎟️', 'Admin'],
  async (ctx) => {
    const userId = ctx.message.from.id;
    const user = await User.findOne({ id: userId });
    if (!user) return ctx.reply('❌ Utilisateur non trouvé.');

    switch (ctx.message.text) {
      case 'Mon compte 💳':
        return ctx.reply(`💰 Solde: ${user.balance} Fcfa\n📈 Invités: ${user.invited_count}\n🎟️ Tickets: ${user.tickets}`);
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
      case 'Tombola 🎟️':
        return ctx.reply('🎟️ 1 invitation = 1 ticket');
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
bot.command('send', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) {
    return ctx.reply('❌ Accès refusé. Vous n\'êtes pas administrateur.');
  }

  // Détection du type de média et récupération du file_id
  const mediaTypes = ['photo', 'video', 'document', 'audio', 'sticker', 'voice', 'video_note'];
  let mediaType = null;
  let mediaFileId = null;

  for (const type of mediaTypes) {
    if (ctx.message[type]) {
      mediaType = type;
      if (type === 'photo') {
        mediaFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      } else {
        mediaFileId = ctx.message[type].file_id;
      }
      break;
    }
  }

  // Récupération du texte (depuis le message ou la légende)
  const sourceText = ctx.message.text || ctx.message.caption || '';
  const messageToSend = sourceText.split(' ').slice(1).join(' ');

  // Validation si pas de média
  if (!mediaType && !messageToSend) {
    return ctx.reply('Veuillez fournir un message ou un média avec légende. Exemple: /send Votre message ici');
  }

  const users = await User.find().select('id');
  let successCount = 0;

  for (const user of users) {
    try {
      if (mediaType) {
        const options = { caption: messageToSend };
        switch (mediaType) {
          case 'photo':
            await bot.telegram.sendPhoto(user.id, mediaFileId, options);
            break;
          case 'video':
            await bot.telegram.sendVideo(user.id, mediaFileId, options);
            break;
          case 'document':
            await bot.telegram.sendDocument(user.id, mediaFileId, options);
            break;
          case 'audio':
            await bot.telegram.sendAudio(user.id, mediaFileId, options);
            break;
          case 'voice':
            await bot.telegram.sendVoice(user.id, mediaFileId, options);
            break;
          case 'sticker':
            await bot.telegram.sendSticker(user.id, mediaFileId);
            if (messageToSend) await bot.telegram.sendMessage(user.id, messageToSend);
            break;
          case 'video_note':
            await bot.telegram.sendVideoNote(user.id, mediaFileId);
            if (messageToSend) await bot.telegram.sendMessage(user.id, messageToSend);
            break;
          default:
            break;
        }
      } else {
        await bot.telegram.sendMessage(user.id, messageToSend);
      }
      successCount++;
    } catch (error) {
      console.error(`Erreur envoi à ${user.id}:`, error.message);
    }
  }

  await ctx.reply(`✅ Message diffusé à ${successCount}/${users.length} utilisateurs.`);
});
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
