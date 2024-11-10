export default {
  async fetch(request, env) {
   console.log('request:', request.method, request.url);

   if (request.method == 'POST') {
     const json = await request.json();
  
     console.log('json:', json);

     if (json.status == 'RECEIVED') {
        if (json.audio) {
          const audioResponse = await fetch(json.audio.audioUrl);
          const blob = await audioResponse.arrayBuffer();
      
          const inputs = {
            audio: [...new Uint8Array(blob)]
          };
          const whisperResponse = await env.AI.run('@cf/openai/whisper', inputs);
          console.log('whisperResponse:', whisperResponse);

          const zapiResponse = await fetch(`${env.Z_API_URL}/send_text`, { phone: json.phone, text: whisperResponse.text });
          console.log('zapiResponse:', zapiResponse);
        }
     }
   }

   return Response.json({ message: 'Received request' });
  }
};