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
            audio: [...new Uint8Array(blob)],
            source_lang: 'pt',
            target_lang: 'pt'
          };
          const whisperResponse = await env.AI.run('@cf/openai/whisper', inputs);
          console.log('whisperResponse:', whisperResponse);

          const zapiResponse = await fetch(`${env.Z_API_URL}/send-text`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.Z_API_TOKEN}` }, 
            body: JSON.stringify({ 
              phone: json.phone, 
              text: whisperResponse.text 
            })
          });
          console.log('zapiResponse:', zapiResponse.statusText, await zapiResponse.text());
        }
     }
   }

   return Response.json({ message: 'Received request' });
  }
};