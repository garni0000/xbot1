require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const http = require('http');
const PLimitImport = () => import('p-limit').then(m => m.default);
const { User, Withdrawal } = require('./database');  // Tes modèles Mongoose

// --- Variables globales ---
const BOT_TOKEN         = process.env.BOT_TOKEN;
const ADMIN_ID          = Number(process.env.ADMIN_ID);
const MONGO_URI         = process.env.MONGO_URI;
const bot               = new Telegraf(BOT_TOKEN);
const adminSessions     = new Map();
const withdrawalProcess = new Map();
let PLimit;

// --- Connexion à MongoDB et lancement ---
(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connecté');
  } catch (err) {
    console.error('❌ Échec connexion MongoDB:', err);
    process.exit(1);
  }

  // --- Middleware debug & gestion d'erreurs globales ---
  bot.use(async (ctx, next) => {
    try {
      console.log(`Update reçu: ${JSON.stringify(ctx.update)}`);
      await next();
    } catch (error) {
      if (error.response?.error_code === 403 && error.response?.description.includes('blocked')) {
        await User.deleteOne({ id: ctx.from.id });
        console.log(`⚠️ Utilisateur ${ctx.from.id} a bloqué le bot, supprimé.`);
      } else {
        console.error('❌ Erreur middleware:', error);
      }
    }
  });

  // --- Utilitaire d'envoi de messages ---
  async function sendMessage(chatId, text, opts = {}) {
    try {
      await bot.telegram.sendMessage(chatId, text, opts);
    } catch (err) {
      if (err.response?.error_code === 403) {
        await User.deleteOne({ id: chatId });
        console.log(`⚠️ Utilisateur ${chatId} a bloqué le bot, supprimé.`);
      } else {
        console.error(`❌ sendMessage à ${chatId}:`, err);
      }
    }
  }

  // --- Vérifie l'abonnement aux canaux ---
  async function isUserInChannels(userId) {
    try {
      const m1 = await bot.telegram.getChatMember('-1002017559099', userId);
      const m2 = await bot.telegram.getChatMember('-1002191790432', userId);
      return ['member','administrator','creator'].includes(m1.status)
          && ['member','administrator','creator'].includes(m2.status);
    } catch (e) {
      console.error('❌ isUserInChannels:', e);
      return false;
    }
  }

  // --- Gestion du parrainage ---
  async function registerUser(userId, username, referrerId) {
    let user = await User.findOne({ id: userId });
    if (!user) {
      user = await User.create({ id: userId, username, referrer_id: referrerId, joined_channels: false });
      console.log(`✅ Utilisateur ${userId} enregistré`);
    }
  }

  async function updateUserBalance(userId) {
    const u = await User.findOne({ id: userId });
    if (!u) return;
    let bonus = 200;
    if (u.invited_count >= 20) bonus = 400;
    else if (u.invited_count >= 10) bonus = 300;
    await User.updateOne({ id: userId }, { balance: u.invited_count * bonus });
  }

  async function notifyReferrer(referrerId, newUserId) {
    await sendMessage(referrerId, `🎉 Un nouvel utilisateur (${newUserId}) s'est inscrit via votre lien !`);
  }

  // --- Commande /start ---
  bot.start(async ctx => {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'Utilisateur';
    const refId = ctx.startPayload ? parseInt(ctx.startPayload) : null;
    await registerUser(userId, username, refId);

    await sendMessage(userId,
      `Bienvenue sur CashXelitebot ! 💴\nRejoignez les canaux pour débloquer l'accès :`, {
        reply_markup: { inline_keyboard: [
          [{ text:'Canal 1', url:'https://t.me/+z73xstC898s4N2Zk' }],
          [{ text:'Canal 2', url:'https://t.me/+z7Ri0edvkbw4MDM0' }],
          [{ text:'Canal 3', url:'https://t.me/+rSXyxHTwcN5lNWE0' }],
          [{ text:'✅ Vérifier', callback_data:'check' }]
        ] }
      }
    );
  });

  // --- Vérification canaux ---
  bot.action('check', async ctx => {
    const uid = ctx.from.id;
    const user = await User.findOne({ id: uid });
    if (!user) return ctx.reply('❌ Utilisateur non trouvé.');
    if (!await isUserInChannels(uid)) return ctx.reply("❌ Rejoignez les canaux d'abord !");

    if (!user.joined_channels) {
      await User.updateOne({ id: uid }, { joined_channels: true });
      if (user.referrer_id) {
        await User.updateOne({ id: user.referrer_id }, { $inc: { invited_count:1, tickets:1 } });
        await updateUserBalance(user.referrer_id);
        await notifyReferrer(user.referrer_id, uid);
      }
    }

    const kb = [
      [{ text:'Mon compte 💳',  callback_data:'acc' }], [{ text:'Inviter📢', callback_data:'invite' }],
      [{ text:'Play to win 🎰', callback_data:'play' }], [{ text:'Withdrawal💸', callback_data:'withdraw' }],
      [{ text:'Support📩', callback_data:'support' }], [{ text:'Tuto 📖', callback_data:'tuto' }],
      [{ text:'Tombola 🎟', callback_data:'tombola' }]
    ];
    if (uid === ADMIN_ID) kb.push([{ text:'Admin', callback_data:'admin_menu' }]);

    await ctx.reply('✅ Accès autorisé !', { reply_markup:{ keyboard: kb, resize_keyboard:true } });
  });

  // --- Gestion menus et commandes textes ---
  bot.hears(/Mon compte 💳|Inviter📢|Play to win 🎰|Withdrawal💸|Support📩|Tuto 📖|Tombola 🎟|Admin/, async ctx => {
    const txt = ctx.message.text;
    const uid = ctx.from.id;
    const user = await User.findOne({ id: uid });
    if (!user) return ctx.reply('❌ Utilisateur non trouvé.');

    switch (txt) {
      case 'Mon compte 💳':
        return ctx.reply(`💰 Solde: ${user.balance} Fcfa\n📈 Invités: ${user.invited_count}\n🎟 Tickets: ${user.tickets}`);
      case 'Inviter📢':
        return ctx.reply(`Invitez: https://t.me/cashXelitebot?start=${uid}`);
      case 'Play to win 🎰':
        return ctx.reply('🎮 Jouer ici: https://t.me/cashXelitebot/cash');
      case 'Withdrawal💸':
        if (user.balance < 10000) return ctx.reply('❌ Minimum 10 000 Fcfa');
        withdrawalProcess.set(uid,{ step:'await_method' });
        return ctx.reply('💸 Méthode de paiement :');
      case 'Support📩': return ctx.reply('📩 Contact: @Medatt00');
      case 'Tuto 📖':    return ctx.reply('📖 Guide: https://t.me/gxgcaca');
      case 'Tombola 🎟': return ctx.reply('🎟 1 invitation = 1 ticket');
      case 'Admin':
        if (uid !== ADMIN_ID) return ctx.reply('❌ Accès refusé');
        return ctx.replyWithMarkdown('🔧 *Menu Admin*', { reply_markup:{ inline_keyboard:[
          [{ text:'👥 Total users', callback_data:'admin_users' }],
          [{ text:'📅 Users/mois',  callback_data:'admin_month' }],
          [{ text:'📢 Diffuser',    callback_data:'admin_broadcast' }]
        ] } });
    }
  });

  // --- Commande /admin ---
  bot.command('admin', async ctx => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply('❌ Accès refusé');
    await ctx.replyWithMarkdown('🔧 *Menu Admin*', { reply_markup:{ inline_keyboard:[
      [{ text:'👥 Total users', callback_data:'admin_users' }],
      [{ text:'📅 Users/mois',  callback_data:'admin_month' }],
      [{ text:'📢 Diffuser',    callback_data:'admin_broadcast' }]
    ] } });
  });

  // --- Admin broadcast via copyMessage ---
  const broadcastState = new Map();
  bot.on('callback_query', async ctx => {
    const uid = ctx.from.id;
    const data = ctx.callbackQuery.data;
    if (uid !== ADMIN_ID) return ctx.answerCbQuery();

    if (data === 'admin_users') {
      const count = await User.countDocuments();
      await ctx.reply(`👥 Total users: ${count}`);
    } else if (data === 'admin_month') {
      const start = new Date(new Date().getFullYear(), new Date().getMonth(),1);
      const count = await User.countDocuments({ createdAt:{ $gte:start } });
      await ctx.reply(`📅 Ce mois: ${count}`);
    } else if (data === 'admin_broadcast') {
      broadcastState.set(uid,{ step:'await_msg' });
      await ctx.reply('📤 Envoyez le message à broadcaster :');
    } else if (data === 'broadcast_cancel') {
      broadcastState.delete(uid);
      await ctx.reply('❌ Broadcast annulé.');
    } else if (data.startsWith('broadcast_')) {
      const [_, chatId, msgId] = data.split('_');
      const users = await User.find({},'id').lean();
      let ok=0;
      await ctx.reply(`Début broadcast à ${users.length} users...`);
      for (const u of users) {
        try { await bot.telegram.copyMessage(u.id, chatId, msgId); ok++; }
        catch{};
      }
      await ctx.reply(`✅ Broadcast: ${ok}/${users.length}`);
    }
    ctx.answerCbQuery();
  });

  // --- Commande /ads ---
  bot.command('ads', async ctx => {
    if (ctx.from.id !== ADMIN_ID) return;
    const total = await User.countDocuments();
    adminSessions.set(ctx.from.id,{ stage:'awaiting_content', total });
    await ctx.reply(`Envoyer pub à ${total} users, envoie contenu :`);
  });

  // Capture contenu ads
  bot.on(['text','photo','video','audio','document','voice'], async ctx => {
    const sess = adminSessions.get(ctx.from.id);
    if (!sess || sess.stage !== 'awaiting_content') return;
    let c = { type:'text', data:ctx.message.text||'' };
    if (ctx.message.photo) { const p=ctx.message.photo.pop(); c={ type:'photo', file_id:p.file_id, caption:ctx.message.caption||'' }; }
    else if (ctx.message.video)    c={ type:'video', file_id:ctx.message.video.file_id, caption:ctx.message.caption||'' };
    else if (ctx.message.audio)    c={ type:'audio', file_id:ctx.message.audio.file_id, caption:ctx.message.caption||'' };
    else if (ctx.message.voice)    c={ type:'voice', file_id:ctx.message.voice.file_id };
    else if (ctx.message.document) c={ type:'document', file_id:ctx.message.document.file_id, caption:ctx.message.caption||'' };
    sess.content=c; sess.stage='awaiting_confirm';
    const prev = { text:c.data, photo:'📸 Photo', video:'🎥 Vidéo', audio:'🎵 Audio', voice:'🎙️ Voice', document:'📄 Doc' }[c.type]||'';
    await ctx.reply(`Préview: ${prev}\nConfirmer ?`, Markup.inlineKeyboard([
      Markup.button.callback('✅ Oui','ads_confirm'),
      Markup.button.callback('❌ Non','ads_cancel')
    ]));
  });

  // Confirm ads
  bot.action('ads_confirm', async ctx => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery();
    const sess = adminSessions.get(ctx.from.id);
    if (!sess || sess.stage!=='awaiting_confirm') return ctx.answerCbQuery();
    await ctx.editMessageText('🔄 Diffusion ads...');
    sess.stage='broadcasting'; broadcastAds(ctx,sess).catch(console.error);
    ctx.answerCbQuery();
  });

  // Cancel ads
  bot.action('ads_cancel', async ctx => {
    if (ctx.from.id!==ADMIN_ID) return ctx.answerCbQuery();
    adminSessions.delete(ctx.from.id);
    await ctx.editMessageText('❌ Ads annulée');
    ctx.answerCbQuery();
  });

  // Fonction broadcastAds
  async function broadcastAds(ctx, sess) {
    if (!PLimit) PLimit = await PLimitImport();
    const limit = PLimit(20);
    let ok=0, fail=0, sent=0;
    const start=Date.now();
    const status = await ctx.reply(`✅0 | ❌0 | 0 msg/s`);
    const users = await User.find({},'id').lean();
    const tasks = users.map(u => limit(async() => {
      try {
        switch(sess.content.type) {
          case 'text':   await bot.telegram.sendMessage(u.id, sess.content.data); break;
          case 'photo':  await bot.telegram.sendPhoto(u.id, sess.content.file_id,{caption:sess.content.caption}); break;
          case 'video':  await bot.telegram.sendVideo(u.id, sess.content.file_id,{caption:sess.content.caption}); break;
          case 'audio':  await bot.telegram.sendAudio(u.id, sess.content.file_id,{caption:sess.content.caption}); break;
          case 'voice':  await bot.telegram.sendVoice(u.id, sess.content.file_id); break;
          case 'document':await bot.telegram.sendDocument(u.id, sess.content.file_id,{caption:sess.content.caption}); break;
        }
        ok++;
      } catch { fail++; }
      sent++;
      if (sent%50===0) {
        const rate=(sent/((Date.now()-start)/1000)).toFixed(2);
        await ctx.telegram.editMessageText(ctx.chat.id,status.message_id,null,`✅:${ok} | ❌:${fail} | ${rate} msg/s`).catch(()=>{});
      }
    }));
    await Promise.all(tasks);
    const totalTime = ((Date.now()-start)/1000).toFixed(2);
    await ctx.telegram.editMessageText(ctx.chat.id,status.message_id,null,`🎉 ✅:${ok} | ❌:${fail} | ${totalTime}s`);
    adminSessions.delete(ctx.from.id);
  }

  // --- Processus de retrait texte ---
  bot.on('text', async ctx => {
    const uid = ctx.from.id;
    const st = withdrawalProcess.get(uid);
    if (!st) return;
    const u = await User.findOne({ id:uid });
    if (!u) { withdrawalProcess.delete(uid); return ctx.reply('❌ Utilisateur non trouvé'); }
    switch(st.step) {
      case 'await_method':
        st.paymentMethod = ctx.message.text; st.step='await_country'; return ctx.reply('🌍 Pays :');
      case 'await_country':
        st.country = ctx.message.text; st.step='await_phone'; return ctx.reply('📞 Tel :');
      case 'await_phone':
        st.phone = ctx.message.text; st.step='await_email'; return ctx.reply('📧 Email :');
      case 'await_email':
        st.email = ctx.message.text;
        await Withdrawal.create({ userId:uid, amount:u.balance,...st });
        await ctx.reply('✅ Retrait enregistré !');
        await sendMessage(ADMIN_ID, `💸 New retrait:\n👤 @${ctx.from.username||'N/A'}\n💰 ${u.balance} Fcfa\n📱 ${st.paymentMethod}\n🌍 ${st.country}\n📞 ${st.phone}\n📧 ${st.email}`);
        withdrawalProcess.delete(uid);
    }
  });

  // --- Erreurs globales ---
  bot.catch((err,ctx) => console.error(`❌ Erreur ${ctx.updateType}:`, err));

  // --- Lancement bot & serveur HTTP ---
  bot.launch().then(() => console.log('🚀 Bot lancé')).catch(e=>{console.error(e); process.exit(1);} );
  http.createServer((req,res)=>{res.writeHead(200);res.end('Bot OK');}).listen(8080,()=>console.log('🌐 HTTP sur 8080'));
})();
