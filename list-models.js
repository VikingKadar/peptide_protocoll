import 'dotenv/config';

async function checkModels() {
  const key = process.env.GEMINI_API_KEY?.trim();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const data = await res.json();
  
  if (data.models) {
    console.log("✅ DINA AKTIVA GEMINI-MODELLER:");
    const flashModels = data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));
    console.log(flashModels);
  } else {
    console.log("Svar:", data);
  }
}

checkModels();