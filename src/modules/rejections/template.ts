// Reply templates for rejections. Tone: firm and direct, never rude. Alex is senior
// and expects a real reason instead of a form letter. English, since recruiters write in English.
// Career facts stay generic here (no company names, no Loopwrk).

export type Stage = 'application' | 'interview' | 'final';
export const STAGE_LABEL: Record<Stage, string> = { application: 'Posle prijave', interview: 'Posle intervjua', final: 'Posle finalnog kruga' };

export interface TplInput { name?: string | null; title: string; stage: Stage; rounds: number; generic: boolean }

const first = (n?: string | null) => (n ?? '').trim().split(/\s+/)[0] || 'there';

export function replyTemplate({ name, title, stage, rounds, generic }: TplInput): string {
  const hi = `Hi ${first(name)},`;
  const sign = 'Best regards,\nAlex Lukovic';
  if (!generic) {
    return [
      hi,
      `Thank you for the update on the ${title} role, and for actually explaining the decision. That is rarer than it should be, and I appreciate it.`,
      `If the situation changes, or a role closer to my profile opens up, I'd be glad to hear from you.`,
      sign,
    ].join('\n\n');
  }
  if (stage === 'application') {
    return [
      hi,
      `Thank you for the update on the ${title} role.`,
      `I'd ask for one thing in return: a concrete reason. I have twelve years of experience leading delivery, implementation and deployment work, and I applied because this role matches that closely. A template message doesn't tell me where I fell short. Was it the level, the domain, location, compensation, or something specific in my background?`,
      `Two or three honest sentences would be enough, and I would actually use them.`,
      sign,
    ].join('\n\n');
  }
  const r = rounds > 1 ? `${rounds} interview rounds` : rounds === 1 ? 'an interview' : 'the interview process';
  return [
    hi,
    `Thank you for letting me know about the ${title} role.`,
    `After ${r} and the preparation that went into ${rounds > 1 ? 'them' : 'it'}, a generic message falls short. At my level I'd expect a clear explanation: what specifically made the team decide I wasn't the right fit${stage === 'final' ? ', and how close the final decision was' : ''}.`,
    `I'm not asking you to reconsider. I'm asking for a straight answer I can learn from, even a brief one.`,
    sign,
  ].join('\n\n');
}
