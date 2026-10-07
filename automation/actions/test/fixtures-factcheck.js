// Shared fixtures for the source fact-check tests (Actions library + n8n fallback nodes).
const INVENTED = 'The update is rolling out to all users and represents a significant expansion of Copilot capabilities within Windows.';

function source(n) {
  return {
    title: 'Microsoft is giving Copilot more control over Windows and your files ' + n,
    link: 'https://www.theverge.com/tech/100711' + n + '/microsoft-windows-copilot',
    desc: 'Microsoft showed off a Copilot upgrade with access to local files.',
    description: '',
    text: 'At its Windows and Surface event, Microsoft showed off an upgrade to Copilot that gives it access to local files on your PC and the ability to take actions across the OS. It is part of an idea Microsoft is calling Hybrid Intelligence, where apps rely on a mix of local and cloud AI models. Jacob Andreou, Microsoft EVP of Copilot, walked through a demo asking Autopilot to help with filing taxes. The new search experience will be available starting this fall on Windows 11 PCs. '.repeat(2),
    ogImage: 'https://example.com/p.jpg', photoOk: true, siteName: 'The Verge', source: 'theverge.com'
  };
}

function gen(n, extraSentence) {
  return {
    candidate: n, supported: true, safe: true, outlet: 'The Verge', category: 'TOOLS',
    igHook: '🤖 Microsoft gives Copilot access to your Windows files and system controls',
    igParagraphs: [
      'Microsoft showed off an upgrade to Copilot at its Windows and Surface event. It gives Copilot access to local files on your PC and the ability to take actions across the OS.',
      'The feature is part of Microsoft\'s Hybrid Intelligence idea, where apps rely on a mix of local and cloud AI models to get tasks done efficiently.',
      'In a demo, Jacob Andreou, Microsoft\'s EVP of Copilot, showed the Autopilot tool helping with filing taxes using files on the PC.',
      'The new Windows search experience arrives this fall on Windows 11 PCs. ' + (extraSentence || '')
    ].map(s => s.trim()),
    liHook: 'Copilot can now reach into the files on your PC.',
    liParagraphs: ['Microsoft showed off a Copilot upgrade with local file access at its Surface event.', 'It is part of what Microsoft calls Hybrid Intelligence.'],
    liTakeaway: 'Local plus cloud AI is Microsoft\'s bet for Windows.',
    igHashtags: ['Microsoft', 'Copilot', 'Windows', 'AI', 'HybridIntelligence'],
    liHashtags: ['Microsoft', 'Copilot', 'Windows', 'AI', 'Tech'],
    graphicHeadline: 'COPILOT GAINS ACCESS TO YOUR WINDOWS FILES', highlightWords: 2,
    summary: 'Microsoft\'s Copilot upgrade gives it access to local Windows files and OS actions via Hybrid Intelligence.'
  };
}

// Fake model: marks items containing any "bad" phrase unsupported; optional rewrite per phrase.
function fakeAsk({ bad = [], rewrites = {}, raw = null, calls = [] } = {}) {
  return async prompt => {
    calls.push(prompt);
    if (raw !== null) return typeof raw === 'function' ? raw(calls.length) : raw;
    const lines = prompt.split('ITEMS:\n')[1].split('\n\nReturn ONLY')[0].split('\n');
    const allowRewrite = /"rewrite"/.test(prompt);
    return JSON.stringify(lines.map(l => {
      const id = l.slice(0, l.indexOf(':'));
      const text = l.slice(l.indexOf(':') + 2);
      const hit = bad.find(b => text.includes(b));
      const v = { id, supported: !hit, why: hit ? 'not in source' : 'stated in source' };
      if (allowRewrite) v.rewrite = hit ? (rewrites[hit] || '') : '';
      return v;
    }));
  };
}

module.exports = { INVENTED, source, gen, fakeAsk };
