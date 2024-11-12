import html from './index.html';

const CHAT_MODEL           = '@cf/meta/llama-3.2-11b-vision-instruct'; //'@cf/meta/llama-3.2-3b-instruct';
const IMAGE_TO_TEXT_MODEL  = '@cf/meta/llama-3.2-11b-vision-instruct';
const SPEECH_TO_TEXT_MODEL = '@cf/openai/whisper';
const TEXT_TO_IMAGE_MODEL  = '@cf/black-forest-labs/flux-1-schnell';
const TEXT_TO_TEXT_MODEL   = '@cf/meta/m2m100-1.2b';

//TODO: Scheduled trigger

async function transcribeAudio(env, audioUrl) {
  const audioResponse = await fetch(audioUrl);
  const blob = await audioResponse.arrayBuffer();
  
  const modelResponse = await env.AI.run(SPEECH_TO_TEXT_MODEL, {
    audio: [...new Uint8Array(blob)],
    source_lang: 'pt',
    target_lang: 'pt'
  });

  console.debug('modelResponse:', modelResponse);
  return modelResponse.text;
}

async function translateText(env, text) {
  const modelResponse = await env.AI.run(TEXT_TO_TEXT_MODEL, {
    text: text,
    source_lang: 'en',
    target_lang: 'pt'
  });

  console.debug('modelResponse:', modelResponse);
  return modelResponse.translated_text;
}

async function transcribeImage(env, imageUrl) {
  const imageResponse = await fetch(imageUrl);
  const blob = await imageResponse.arrayBuffer();
  
  let modelResponse = await env.AI.run(IMAGE_TO_TEXT_MODEL, {
    prompt: 'agree'
  });

  modelResponse = await env.AI.run(IMAGE_TO_TEXT_MODEL, {
    prompt: 'descreva a imagem',
    image: [...new Uint8Array(blob)]
  });

  console.debug('modelResponse:', modelResponse);
  return await translateText(env, modelResponse.response);
}


async function generateImage(env, text) {
  const modelResponse = await env.AI.run(TEXT_TO_IMAGE_MODEL, {
    prompt: text
  });

  console.debug('modelResponse:', modelResponse);
  return modelResponse.image;
}

async function inferChat(env, text, phone, role = 'user') {
  if (text.includes('imagem') || text.includes('foto') || text.includes('desenho')) {
    const image = await generateImage(env, text);

    return `data:image/png;base64,${image}`;
  }

  const records = await env.KV.get('records', 'json');
  const record = records.find(r => r.user.phone === phone || r.parent.phone === phone) || {};

  const messages = [
    { 
      role: 'system', 
      content: 
      `Você é um terapeuta especializado em acompanhar e dialogar com pacientes crianças e seus pais separadamente. 
      Os dados do paciente estão estruturados em formato JSON a seguir: 

      \`\`\`
      ${JSON.stringify(record, null, 2)}
      \`\`\`

      O usuário pode ser o paciente ou o responsável, dependendo do número de telefone cadastrado.
      Se não conseguir identificar o usuário, você pode perguntar diretamente.
      Caso o usuário entre em contato, coletar relato e informações sobre o paciente para registrar no sistema.
      `
    },
    //TODO: Recent messages from KV
    { 
      role: role, 
      content: 
      `Usuário com telefone ${phone}: ${text}` 
    }
  ];
  console.debug('messages:', JSON.stringify(messages, null, 2));

  const modelResponse = await env.AI.run(CHAT_MODEL, { 
    messages
    //functions: [],
    //tools: []
  });
  
  console.debug('modelResponse:', modelResponse);

  return modelResponse.response;
}

async function sendWhatsAppMessage(env, phone, text) {
  console.debug('sendWhatsAppMessage:', phone, text.substring(0, Math.min(100, text.length)));

  let endpoint = 'send-text';
  let body = { 
    phone: phone, 
    message: text 
  };

  if (text.startsWith('data:image')) {
    endpoint = 'send-image';
    body = { 
      phone: phone, 
      image: text 
    };
  }

  return await sendZAPIRequest(env, endpoint, body);
}

async function updateZAPIWebhook(env, type, value) {
  return await sendZAPIRequest(env, `update-webhook-${type}`, { value }, 'PUT');
}

async function sendZAPIRequest(env, endpoint, body, method = 'POST') {
  const zapiResponse = await fetch(`${env.Z_API_URL}/${endpoint}`, { 
    method: method, 
    headers: { 
      'Content-Type': 'application/json', 
      'Client-Token': env.Z_API_TOKEN 
    }, 
    body: JSON.stringify(body)
  });

  console.debug('[zapi:response]', zapiResponse.statusText, await zapiResponse.text());

  return zapiResponse.status >= 200 && zapiResponse.status < 300;
}

export default {
  async fetch(request, env) {
   const url = new URL((request.headers ? request.headers.get('mf-original-url') : null) || request.url);

   console.debug('[request:start]', request.method, url.href); //, JSON.stringify(Object.fromEntries(request.headers), null, 2));

   let phone = null;

   try {
    if (request.method == 'GET' && url.pathname == '/') {
      url.pathname = '/webhook';

      const updated = await updateZAPIWebhook(env, 'received', url.href);

      console.debug('[zapi:webhook:updated]', updated, 'webhook endpoint:', url.href);

      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      //return Response.json({ message: 'Webhook updated', success: updated });

    } if (request.method == 'GET' && url.pathname == '/records') {
        const records = await env.KV.get('records', 'json');
  
        return Response.json({ records: records || [], success: true });

    } if (request.method == 'POST' && url.pathname.includes('/trigger')) {
      const paths = url.pathname.split('/');
      const phone = paths.pop();
      const type = paths.pop();

      const prompts = {
        initial: 'Se apresente e informe o motivo do contato tanto para o pai quanto para o filho de acordo com o número de telefone identificado contra o cadastro.',
        daily: 'Pergunte como foi o dia do paciente e se houve alguma mudança no comportamento ou sintomas.',
        weekly: 'Faça um resumo da semana e envie para o pai uma cópia textual do relatório semanal.',
      };

      const text = await inferChat(env, prompts[type], phone, 'user');
 
      const sent = await sendWhatsAppMessage(env, phone, text);

      return Response.json({ message: text, success: sent });

    } else if (request.method == 'POST' && url.pathname == '/webhook') {
      const json = await request.json();
   
      console.debug('[request:json]', JSON.stringify(json, null, 2));

      phone = json.phone;
 
      if (json.status == 'RECEIVED') {
         if (json.audio) {
           const text = await transcribeAudio(env, json.audio.audioUrl);
 
           await sendWhatsAppMessage(env, phone, text);
         }
 
         if (json.image) {
           const text = await transcribeImage(env, json.image.imageUrl);
 
           await sendWhatsAppMessage(env, phone, text);
         }
 
         if (json.text) {
           const text = await inferChat(env, json.text.message, phone);
 
           await sendWhatsAppMessage(env, phone, text);
         }
      }
    }
 
    return Response.json({ message: 'Received request' });
   } catch (error) {
    console.error('error:', error);

    if (phone) await sendWhatsAppMessage(env, phone, `*Erro:* \`${error.message}\``);

    return Response.json({ message: error.message, stack: error.stack }, { status: 500 });
   }
  }
};