
const CHAT_MODEL           = '@cf/meta/llama-3.2-3b-instruct';
const IMAGE_TO_TEXT_MODEL  = '@cf/meta/llama-3.2-11b-vision-instruct';
const SPEECH_TO_TEXT_MODEL = '@cf/openai/whisper';
const TEXT_TO_IMAGE_MODEL  = '@cf/black-forest-labs/flux-1-schnell';
const TEXT_TO_TEXT_MODEL   = '@cf/meta/m2m100-1.2b';

//TODO: Update webhook on GET

async function transcribeAudio(env, audioUrl) {
  const audioResponse = await fetch(audioUrl);
  const blob = await audioResponse.arrayBuffer();
  
  const modelResponse = await env.AI.run(SPEECH_TO_TEXT_MODEL, {
    audio: [...new Uint8Array(blob)],
    source_lang: 'pt',
    target_lang: 'pt'
  });

  console.log('modelResponse:', modelResponse);
  return modelResponse.text;
}

async function translateText(env, text) {
  const modelResponse = await env.AI.run(TEXT_TO_TEXT_MODEL, {
    text: text,
    source_lang: 'en',
    target_lang: 'pt'
  });

  console.log('modelResponse:', modelResponse);
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

  console.log('modelResponse:', modelResponse);
  return await translateText(env, modelResponse.response);
}


async function generateImage(env, text) {
  const modelResponse = await env.AI.run(TEXT_TO_IMAGE_MODEL, {
    prompt: text
  });

  console.log('modelResponse:', modelResponse);
  return modelResponse.image;
}

async function inferChat(env, text, phone, role = 'user') {
  if (text.includes('imagem') || text.includes('foto') || text.includes('desenho')) {
    const image = await generateImage(env, text);

    return `data:image/png;base64,${image}`;
  }

  const messages = [
    { 
      role: 'system', 
      content: 
      `Você é um terapeuta especializado em acompanhar e dialogar com pacientes crianças e seus pais separadamente. 
      Os dados do paciente estão estruturados em formato JSON a seguir: 

      \`\`\`
      {}
      \`\`\`

      O usuário pode ser o paciente ou o responsável, dependendo do número de telefone cadastrado.
      Se não conseguir identificar o usuário, você pode perguntar diretamente.
      Caso o usuário entre em contato, coletar relato e informações sobre o paciente para registrar no sistema.
      `
    },
    //TODO: JSON from KV
    //TODO: Recent messages from KV
    { 
      role: role, 
      content: 
      `Usuário com telefone ${phone}: ${text}` 
    }
  ];
  console.log('messages:', messages);

  const modelResponse = await env.AI.run(CHAT_MODEL, { 
    messages
    //functions: [],
    //tools: []
  });
  
  console.log('modelResponse:', modelResponse);

  return modelResponse.response;
}

async function sendWhatsAppMessage(env, phone, text) {
  console.log('sendWhatsAppMessage:', phone, text.substring(0, Math.min(100, text.length)));

  let endpoint = 'send-text';
  let body = JSON.stringify({ 
    phone: phone, 
    message: text 
  });

  if (text.startsWith('data:image')) {
    endpoint = 'send-image';
    body = JSON.stringify({ 
      phone: phone, 
      image: text 
    });
  }

  const zapiResponse = await fetch(`${env.Z_API_URL}/${endpoint}`, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json', 'Client-Token': env.Z_API_TOKEN }, 
    body: body
  });

  console.log('zapiResponse:', zapiResponse.statusText, await zapiResponse.text());

  return zapiResponse.status >= 200 && zapiResponse.status < 300;
}

export default {
  async fetch(request, env) {
   console.log('request:', request.method, request.url);

   let phone = null;

   try {
    if (request.method == 'POST') {
      const json = await request.json();
   
      console.log('json:', json);

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

    await sendWhatsAppMessage(env, phone, `*Erro:* \`${error.message}\``);

    return Response.json(error, { status: 500 });
   }
  }
};