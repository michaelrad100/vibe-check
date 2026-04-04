export const NSFW_BLOCKLIST = [
  'porn','sex','nude','naked','xxx','hentai','erotic','fetish','onlyfans',
  'nsfw','dick','cock','pussy','anal','blowjob','cum','orgasm','masturbat',
  'fuck','shit','bitch','nigger','faggot','retard','cunt','whore','slut',
  'rape','molest','pedophil','incest','bestiality','zoophil',
  'drug deal','meth','cocaine','heroin','fentanyl',
  'kill','murder','suicide','bomb','terror','weapon','gun store','ammo'
];

export function isNSFW(text) {
  const lower = text.toLowerCase();
  return NSFW_BLOCKLIST.some(word => lower.includes(word));
}

export function normalizeIdea(idea) {
  return idea.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function parseJSON(text) {
  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) try { return JSON.parse(match[0]); } catch {}
  throw new Error('Could not parse JSON from Perplexity response');
}
