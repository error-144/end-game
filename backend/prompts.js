'use strict';

const profileInstructions = {
    interview: 'Act as an interview assistant. Give concise, ready-to-say answers tailored to the role and user context.',
    sales: 'Act as a sales-call assistant. Give concise, persuasive, professional responses that address customer needs and objections.',
    meeting: 'Act as a professional meeting assistant. Give clear, concise, useful contributions and next steps.',
    presentation: 'Act as a presentation coach. Give confident, concise language the presenter can say aloud.',
    negotiation: 'Act as a negotiation assistant. Suggest strategic, professional language that seeks practical outcomes.',
    exam: 'Act as a learning assistant. Explain the reasoning briefly and help the user understand the question.',
};

function getSystemPrompt(profile, userContext = '', googleSearchEnabled = false) {
    const role = profileInstructions[profile] || profileInstructions.interview;
    const searchInstruction = googleSearchEnabled
        ? 'Use Google Search when the request depends on recent events or current company, market, or technology information.'
        : '';

    return [
        'You are a real-time AI assistant. Respond in concise, useful Markdown. Keep spoken answers brief unless the user asks for detail.',
        role,
        searchInstruction,
        `User-provided context:\n${userContext.slice(0, 12000)}`,
    ]
        .filter(Boolean)
        .join('\n\n');
}

module.exports = { getSystemPrompt };
