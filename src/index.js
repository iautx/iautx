
const CHAT_MODEL           = '@cf/meta/llama-3.1-8b-instruct-fast';
const IMAGE_TO_TEXT_MODEL  = '@cf/llava-hf/llava-1.5-7b-hf'; //'@cf/meta/llama-3.2-11b-vision-instruct';
const SPEECH_TO_TEXT_MODEL = '@cf/openai/whisper';
const TEXT_TO_IMAGE_MODEL  = '@cf/black-forest-labs/flux-1-schnell';

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

async function transcribeImage(env, imageUrl) {
  const imageResponse = await fetch(imageUrl);
  const blob = await imageResponse.arrayBuffer();
  
  const modelResponse = await env.AI.run(IMAGE_TO_TEXT_MODEL, {
    prompt: 'accept',
    image: [...new Uint8Array(blob)]
  });

  console.log('modelResponse:', modelResponse);
  return modelResponse.text;
}

async function inferChat(env, text, phone, role = 'user') {
  const messages = [
    { 
      role: 'system', 
      content: 
      `Você é um terapeuta especializado em acompanhar pacientes crianças e seus pais. 
      Os dados do paciente estão estruturados em formato JSON a seguir: \`\`\`{}\`\`\`` 
    },
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
  console.log('sendWhatsAppMessage:', phone, text);

  const zapiResponse = await fetch(`${env.Z_API_URL}/send-text`, { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json', 'Client-Token': env.Z_API_TOKEN }, 
    body: JSON.stringify({ 
      phone: phone, 
      message: text 
    })
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