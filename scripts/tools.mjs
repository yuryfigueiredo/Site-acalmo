import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from '../src/assets/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const origin = config.siteOrigin;
const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const menuIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const closeIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>';
const playIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 12 8-12 8V4Z"/></svg>';

const safety = `<div class="tool-safety"><p>Se você estiver em sofrimento intenso ou pensando em se machucar, ligue <strong>188</strong> (CVV, 24 horas, ligação gratuita) ou acesse <a href="https://cvv.org.br/" target="_blank" rel="noopener noreferrer">cvv.org.br</a>. O Acalmo oferece pausas de bem-estar e não realiza atendimento de emergência nem substitui cuidados profissionais.</p></div>`;

function menuDialog() {
  return `<dialog class="menu-dialog" id="page-menu-dialog" aria-label="Menu de navegação"><div class="dialog-top"><a href="/" class="wordmark">acalmo.</a><button class="icon-button" data-close="page-menu-dialog" aria-label="Fechar menu">${closeIcon}</button></div><nav class="menu-list" aria-label="Navegação do menu"><a href="/#experiencias">Encontre sua pausa</a><a href="/#sons">Sons</a><a href="/#rituais">Pequenos rituais</a><a href="/guia/">Guia gratuito</a><a href="/blog/">Todas as leituras</a></nav><p class="menu-note">Sem cadastro. Suas escolhas ficam neste navegador.</p></dialog>`;
}

function breadcrumbs(tool) {
  const crumbs = [['Acalmo', '/'], [tool.group, tool.groupHref], [tool.title, null]];
  const sep = '<span class="crumb-sep" aria-hidden="true">/</span>';
  return `<nav class="breadcrumbs" aria-label="Você está aqui">${crumbs.map(([name, href]) => href ? `<a href="${href}">${esc(name)}</a>` : `<span aria-current="page">${esc(name)}</span>`).join(sep)}</nav>`;
}

function structuredData(tool) {
  const url = origin + tool.route;
  const publisher = { '@type': 'Organization', '@id': origin + '/#organization', name: 'Acalmo', url: origin + '/', description: 'Um lugar para desacelerar.' };
  const website = { '@type': 'WebSite', '@id': origin + '/#website', url: origin + '/', name: 'Acalmo', inLanguage: 'pt-BR', publisher };
  const app = { '@type': 'WebApplication', '@id': url + '#app', name: tool.title, url, description: tool.description, applicationCategory: 'LifestyleApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript and Web Audio support', inLanguage: 'pt-BR', isPartOf: website, publisher, offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' }, featureList: tool.features, breadcrumb: { '@id': url + '#breadcrumb' } };
  const crumbs = [{ name: 'Acalmo', item: origin + '/' }, { name: tool.group, item: origin + tool.groupHref }, { name: tool.title, item: url }];
  const graph = [app, website, { '@type': 'BreadcrumbList', '@id': url + '#breadcrumb', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })) }];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c');
}

function widget(tool) {
  if (tool.kind === 'sound') return `<div class="tool-widget"><p class="tool-kicker">${esc(tool.kicker)}</p><p class="tool-name">${esc(tool.sceneTitle)}</p><p class="tool-sub">${esc(tool.sceneSub)}</p><div class="tool-controls"><button class="tool-play" id="tool-play" data-label="${esc(tool.sceneTitle)}" aria-pressed="false" aria-label="Tocar ${esc(tool.sceneTitle)}">${playIcon}</button><div class="tool-volume"><label for="tool-volume">Volume <output id="tool-volume-value">${tool.volume}%</output></label><input id="tool-volume" type="range" min="0" max="100" value="${tool.volume}"></div><div class="tool-select"><label for="tool-timer">Parar em</label><select id="tool-timer"><option value="0">Sem limite</option><option value="5">5 minutos</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option></select></div></div><p class="tool-status" id="tool-status" role="status"></p><p class="tool-cycle" id="tool-timer-status"></p></div>`;
  if (tool.kind === 'breath') return `<div class="tool-widget"><p class="tool-kicker">${esc(tool.kicker)}</p><p class="tool-name">${esc(tool.sceneTitle)}</p><p class="tool-sub">${esc(tool.sceneSub)}</p><div class="tool-orb-wrap"><div class="tool-orb" id="tool-orb"><div class="tool-orb-inner"><span class="tool-phase" id="tool-phase">No seu tempo</span><span class="tool-count" id="tool-count">—</span></div></div></div><p class="tool-cycle" id="tool-cycle"></p><div class="tool-controls"><button class="button primary" id="tool-start">Começar</button><button class="button secondary" id="tool-stop" hidden>Encerrar</button></div><p class="tool-status" id="tool-status" role="status"></p></div>`;
  return `<div class="tool-widget"><p class="tool-kicker">${esc(tool.kicker)}</p><p class="tool-name">${esc(tool.sceneTitle)}</p><p class="tool-sub">${esc(tool.sceneSub)}</p><p class="tool-clock" id="tool-clock">50:00</p><p class="tool-cycle" id="tool-focus-phase">Um bloco, uma coisa</p><div class="tool-controls"><button class="button primary" id="tool-start">Começar bloco</button><button class="button secondary" id="tool-reset" hidden>Recomeçar</button></div><p class="tool-status" id="tool-status" role="status"></p></div>`;
}

function related(tool) {
  const items = tool.related.map(route => tools.find(t => t.route === route)).filter(Boolean);
  return `<nav class="tool-related" aria-label="Outras ferramentas">${items.map(t => `<a href="${t.route}"><span class="small-label">${esc(t.group)}</span><h2>${esc(t.sceneTitle)}</h2><span class="text-link">Abrir com calma</span></a>`).join('')}</nav>`;
}

function page(tool) {
  const url = origin + tool.route;
  const dataAttrs = tool.kind === 'sound' ? `data-tool="sound" data-channel="${tool.channel}"` : tool.kind === 'breath' ? `data-tool="breath" data-pattern="${tool.pattern}"` : `data-tool="focus" data-minutes="${tool.minutes}"`;
  return `<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tool.title)} — Acalmo</title><meta name="description" content="${esc(tool.description)}"><meta name="robots" content="${config.indexable ? 'index,follow' : 'noindex,nofollow'}"><meta name="theme-color" content="#f5f2e9"><link rel="canonical" href="${url}"><meta property="og:title" content="${esc(tool.title)} — Acalmo"><meta property="og:description" content="${esc(tool.description)}"><meta property="og:url" content="${url}"><meta property="og:type" content="website"><meta property="og:locale" content="pt_BR"><meta property="og:image" content="${origin}/assets/og-cover.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/assets/icon.svg"><link rel="apple-touch-icon" href="/assets/icon-192.png"><link rel="manifest" href="/manifest.webmanifest"><link rel="preload" href="/assets/acalmo-serif-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/assets/style.css"><link rel="stylesheet" href="/assets/refinements.css"><link rel="stylesheet" href="/assets/tools.css"><script>try{const t=localStorage.getItem('acalmo:theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.dataset.theme='dark';document.querySelector('meta[name=theme-color]').content='#172a24';}}catch{}</script><script type="application/ld+json">${structuredData(tool)}</script><script type="module" src="/assets/page.js"></script><script type="module" src="/assets/tool.js"></script></head><body ${dataAttrs}><a class="skip-link" href="#conteudo">Ir para o conteúdo</a><div class="tool-stage"><div class="tool-scene ${tool.scene}" aria-hidden="true"></div><header class="tool-header"><a href="/" class="wordmark" aria-label="Acalmo, início">acalmo.</a><div class="tool-header-actions"><button id="page-theme" class="text-button" aria-pressed="false">Modo noturno</button><button class="menu-button" id="page-menu" aria-label="Abrir menu de navegação" aria-haspopup="dialog">${menuIcon}</button></div></header>${widget(tool)}<p class="tool-hint"><a href="#conteudo">Role para ler sobre esta prática</a></p></div><main class="tool-reading" id="conteudo"><div class="wrap">${breadcrumbs(tool)}<h1>${esc(tool.title)}</h1>${tool.content}${safety}${related(tool)}<p><a class="button primary" href="/">Voltar ao Acalmo</a></p></div></main><footer class="site-footer"><div class="wrap footer-top"><div><a href="/" class="wordmark">acalmo.</a><p>Um lugar para desacelerar.</p></div><nav aria-label="Informações"><a href="/blog/">Todas as leituras</a><a href="/guia/">Pequeno manual de pausas</a><a href="/sobre/">Sobre o Acalmo</a><a href="/privacidade/">Privacidade e seus dados</a></nav><p class="footer-note">Conteúdo de bem-estar.<br>Não substitui cuidados profissionais.</p></div></footer>${menuDialog()}</body></html>`;
}

const tools = [
  {
    route: '/sons/ruido-marrom/', kind: 'sound', channel: 'brown', volume: 45, scene: 'scene-brown',
    group: 'Sons', groupHref: '/#sons', kicker: 'Ruído contínuo · sintetizado aqui', sceneTitle: 'Ruído marrom', sceneSub: 'Um fundo grave e constante, gerado no seu dispositivo.',
    title: 'Ruído marrom para foco e descanso',
    description: 'Ouça ruído marrom sintetizado no navegador, sem cadastro e sem download. Entenda quando ele pode ajudar e como usar em volume confortável.',
    features: 'Ruído marrom sintetizado localmente, controle de volume, temporizador de parada, modo noturno',
    related: ['/sons/chuva/', '/foco/50-minutos/'],
    content: `
    <p class="article-lead">O ruído marrom é um som contínuo e grave, parecido com uma cachoeira distante ou um trovão abafado. Ele não tem melodia nem palavras: é apenas um fundo estável.</p>
    <p>Em termos de frequência, o ruído marrom concentra mais energia nas partes baixas do espectro. Por isso soa mais encorpado e menos agudo que o ruído branco, aquele chiado de televisão fora do ar. Muita gente descreve a sensação como um zumbido profundo e constante, sem pontas nem sustos.</p>
    <h2>Quando ele pode fazer sentido</h2>
    <p>Um fundo estável pode suavizar a diferença entre o silêncio e um barulho repentino: uma porta, um carro, uma conversa ao lado. Durante a leitura ou o trabalho, essa constância pode ajudar a manter a atenção no que está na frente. Outras pessoas gostam de um fundo grave enquanto descansam, antes de dormir.</p>
    <p>Comece em volume baixo e aumente só até o ponto confortável. A ideia não é abafar tudo ao redor: você ainda precisa ouvir avisos, pessoas e o que acontece no ambiente. Se o som incomodar, diminua ou desligue. Silêncio também é uma escolha válida.</p>
    <h2>Como usar aqui</h2>
    <p>O ruído é sintetizado no seu navegador com Web Audio. Não é uma gravação, não baixa arquivo nenhum e não exige cadastro. Toque para ouvir, ajuste o volume e, se quiser, escolha um temporizador para que o som termine sozinho sem você voltar à tela.</p>
    <p>Se preferir combinar camadas, a página inicial do Acalmo tem um mixer com chuva, mar, mata e lareira, além dos ruídos marrom, rosa e branco. Você pode copiar o link da combinação e guardar para depois.</p>
    <h2>Marrom, rosa ou branco?</h2>
    <p>O marrom é o mais grave e encorpado. O rosa fica no meio do caminho, mais suave que o branco. O branco é o mais agudo e brilhante, parecido com um chiado. Não existe um vencedor: existe o que soa confortável para você hoje. Experimente um de cada vez, em volume baixo.</p>
    <h2>O que ele não faz</h2>
    <p>Ruído não cura insônia, ansiedade ou dificuldade de atenção. As evidências sobre sons para dormir são mistas e variam de pessoa para pessoa. Encare como um conforto possível, não como tratamento. Se a dificuldade para dormir ou se concentrar persistir, vale conversar com um profissional de saúde.</p>
    <div class="article-source"><p>Referências: <a href="https://www.sleepfoundation.org/noise-and-sleep/pink-noise" target="_blank" rel="noopener noreferrer">Sleep Foundation — pink noise</a> e <a href="https://www.sleepfoundation.org/noise-and-sleep" target="_blank" rel="noopener noreferrer">Sleep Foundation — noise and sleep</a>, que descrevem as cores de ruído, incluindo o marrom. O texto do Acalmo é editorial, sem promessa de resultado clínico.</p></div>`
  },
  {
    route: '/sons/chuva/', kind: 'sound', channel: 'rain', volume: 40, scene: 'scene-rain',
    group: 'Sons', groupHref: '/#sons', kicker: 'Paisagem sonora · sintetizada aqui', sceneTitle: 'Chuva mansa', sceneSub: 'Um ritmo delicado e constante, sem trovões nem sustos.',
    title: 'Som de chuva para dormir e estudar',
    description: 'Chuva mansa sintetizada no navegador, com volume e temporizador. Um fundo estável para leitura, trabalho ou descanso, sem cadastro.',
    features: 'Chuva sintetizada localmente, controle de volume, temporizador de parada, modo noturno',
    related: ['/sons/ruido-marrom/', '/respiracao/quadrada/'],
    content: `
    <p class="article-lead">A chuva mansa é um som familiar e estável: muitas gotas pequenas, sem trovões e sem mudanças bruscas. É esse caráter constante que a torna agradável como fundo.</p>
    <p>Sons contínuos da natureza funcionam como uma espécie de cortina sonora. Eles não eliminam os barulhos ao redor, mas reduzem o contraste entre o silêncio e um som repentino, que é o que costuma chamar a atenção. Por isso muita gente escolhe chuva para ler, estudar ou desacelerar no fim do dia.</p>
    <h2>Quando usar</h2>
    <p>Experimente durante uma tarefa que pede atenção contínua, como leitura ou escrita, ou como parte de uma transição antes de descansar. Não há um momento obrigatório: se a chuva soar agradável agora, ela cabe agora. Se não soar, o silêncio continua disponível.</p>
    <p>Mantenha o volume em um nível confortável, baixo o suficiente para você ainda ouvir o ambiente. Sons não devem bloquear avisos importantes nem a atenção necessária para outras atividades, como cuidar de alguém ou cozinhar.</p>
    <h2>Como usar aqui</h2>
    <p>A chuva do Acalmo é sintetizada no dispositivo, não uma gravação de lugar real. Não baixa arquivo e não pede cadastro. Toque para ouvir, ajuste o volume e escolha um temporizador se quiser que o som pare sozinho depois de alguns minutos.</p>
    <p>Para combinar chuva com mar, mata ou lareira, use o mixer da página inicial. Cada camada tem volume próprio, e a combinação pode ser guardada neste navegador ou copiada como link.</p>
    <h2>O que ela não faz</h2>
    <p>Som de chuva não faz dormir nem trata insônia ou ansiedade. Ele pode tornar o ambiente mais agradável para descansar, e só. O sono depende de muitos fatores: rotina, luz, temperatura, preocupações e saúde. Se a dificuldade para dormir persistir, procure orientação profissional em vez de aumentar o volume.</p>
    <div class="article-source"><p>Referência: <a href="https://www.sleepfoundation.org/noise-and-sleep/white-noise" target="_blank" rel="noopener noreferrer">Sleep Foundation — white noise</a>, sobre sons contínuos e mascaramento de ruídos no sono. O texto do Acalmo é editorial, sem promessa de resultado clínico.</p></div>`
  },
  {
    route: '/respiracao/quadrada/', kind: 'breath', pattern: 'quadrada', scene: 'scene-box',
    group: 'Respiração', groupHref: '/#experiencias', kicker: 'Respiração guiada · no seu ritmo', sceneTitle: 'Respiração quadrada', sceneSub: 'Quatro tempos iguais: inspire, segure, solte, segure sem ar.',
    title: 'Respiração quadrada: quatro tempos iguais',
    description: 'Pratique respiração quadrada (box breathing) com um guia visual: inspire, segure, solte e segure sem ar, quatro segundos cada. Sem cadastro.',
    features: 'Guia visual de respiração quadrada, quatro ciclos, pausar e encerrar a qualquer momento, modo noturno',
    related: ['/respiracao/4-7-8/', '/foco/50-minutos/'],
    content: `
    <p class="article-lead">A respiração quadrada, também chamada de box breathing, divide o ciclo em quatro partes iguais: inspirar, segurar, soltar e segurar sem ar. Aqui, cada parte dura quatro segundos.</p>
    <p>O nome vem da forma de um quadrado: quatro lados do mesmo tamanho. A contagem funciona como um ponto de atenção simples, algo para acompanhar enquanto o corpo respira. Não é uma medida de desempenho nem uma prova de que você está fazendo certo.</p>
    <h2>Como usar aqui</h2>
    <p>A esfera cresce ao inspirar, fica parada durante a retenção, diminui ao soltar e fica parada novamente sem ar. O padrão são quatro ciclos. Toque em começar quando estiver confortável; pause ou encerre a qualquer momento, sem precisar terminar a sequência.</p>
    <p>Se a retenção incomodar, não force. Você pode acompanhar apenas a inspiração e a expiração, ou usar o ritmo livre da página inicial, que não exige segurar o ar. Respirar guiado deve ser confortável; se causar tontura ou aperto, pare e volte ao ritmo natural.</p>
    <h2>Quando ela pode caber</h2>
    <p>Algumas pessoas usam a respiração quadrada como uma transição: entre duas tarefas, antes de uma conversa difícil ou ao perceber que a atenção se espalhou. Outros a usam apenas como um momento de pausa. Não há horário certo nem obrigação de repetir todos os dias.</p>
    <h2>O que ela não é</h2>
    <p>A respiração quadrada não trata ansiedade, pânico nem qualquer condição de saúde. Ela é uma prática de atenção e conforto, popular em contextos de treinamento e relaxamento, mas sem promessa de resultado clínico. A orientação de respiração suave do NHS reforça o mesmo princípio: sem forçar, com contagem apenas se ela for útil.</p>
    <p>Se você vive momentos intensos de angústia com frequência, uma pausa guiada não substitui acompanhamento profissional. Procure um serviço de saúde quando precisar de cuidado contínuo.</p>
    <div class="article-source"><p>Referências: <a href="https://www.healthline.com/health/copd/box-breathing" target="_blank" rel="noopener noreferrer">Healthline — box breathing</a> e <a href="https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/" target="_blank" rel="noopener noreferrer">NHS — breathing exercises for stress</a>. O texto do Acalmo é editorial, sem revisão clínica declarada.</p></div>`
  },
  {
    route: '/respiracao/4-7-8/', kind: 'breath', pattern: '4-7-8', scene: 'scene-478',
    group: 'Respiração', groupHref: '/#experiencias', kicker: 'Respiração guiada · no seu ritmo', sceneTitle: 'Respiração 4-7-8', sceneSub: 'Inspire em 4, segure em 7, solte em 8.',
    title: 'Respiração 4-7-8 para desacelerar',
    description: 'Um guia visual para a respiração 4-7-8: inspire 4, segure 7, solte 8. Quatro ciclos, no seu ritmo, sem cadastro e sem promessa de resultado.',
    features: 'Guia visual de respiração 4-7-8, quatro ciclos, pausar e encerrar a qualquer momento, modo noturno',
    related: ['/respiracao/quadrada/', '/sons/ruido-marrom/'],
    content: `
    <p class="article-lead">A respiração 4-7-8 organiza o ciclo em três tempos: inspirar por quatro, segurar por sete e soltar por oito. A expiração mais longa é a marca desse padrão.</p>
    <p>O formato foi popularizado pelo médico Andrew Weil como um exercício de relaxamento inspirado em práticas de respiração mais antigas. Aqui ele aparece como um guia visual simples, sem misticismo e sem promessa: uma contagem para acompanhar enquanto você respira com conforto.</p>
    <h2>Como usar aqui</h2>
    <p>A esfera cresce durante a inspiração, permanece ampliada na retenção e diminui lentamente na expiração. O padrão são quatro ciclos. Comece quando estiver confortável; pause ou encerre quando quiser, mesmo no meio de um ciclo.</p>
    <p>Segurar o ar por sete segundos pode ser desconfortável para algumas pessoas. Se for o seu caso, não force: reduza a retenção na sua cabeça, acompanhe só o movimento da esfera ou escolha o ritmo livre da página inicial, sem retenção. Tontura, aperto ou falta de ar são sinais para parar e voltar ao ritmo natural.</p>
    <h2>Quando ela pode caber</h2>
    <p>Muita gente reserva a respiração 4-7-8 para o fim do dia, como uma transição antes de descansar, ou depois de um momento tenso. Ela também pode servir como uma pausa curta entre tarefas. Não existe obrigação de fazer todos os dias nem um número certo de repetições além do que for confortável.</p>
    <h2>O que ela não é</h2>
    <p>A respiração 4-7-8 não cura ansiedade nem insônia e não substitui tratamento. É uma prática de conforto e atenção, com evidência limitada e efeito variável entre pessoas. Se a angústia ou a dificuldade para dormir persistirem, procure um profissional de saúde.</p>
    <p>Em momentos de sofrimento intenso, uma pausa guiada não é o recurso adequado. Use os canais de apoio indicados abaixo ou um serviço de emergência.</p>
    <div class="article-source"><p>Referências: <a href="https://www.healthline.com/health/4-7-8-breathing" target="_blank" rel="noopener noreferrer">Healthline — 4-7-8 breathing</a> e <a href="https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/" target="_blank" rel="noopener noreferrer">NHS — breathing exercises for stress</a>. O texto do Acalmo é editorial, sem revisão clínica declarada.</p></div>`
  },
  {
    route: '/foco/50-minutos/', kind: 'focus', minutes: 50, scene: 'scene-focus',
    group: 'Foco', groupHref: '/#rituais', kicker: 'Bloco de atenção · sem pontuação', sceneTitle: '50 minutos', sceneSub: 'Um bloco de atenção para uma coisa só.',
    title: 'Foco de 50 minutos: um bloco de atenção',
    description: 'Um temporizador de 50 minutos para dedicar a uma coisa só, com pausa ao final. Sem cadastro, sem pontuação, no seu ritmo.',
    features: 'Temporizador de bloco de 50 minutos, pausar e recomeçar, sem pontuação nem sequência, modo noturno',
    related: ['/sons/chuva/', '/respiracao/quadrada/'],
    content: `
    <p class="article-lead">Um bloco de tempo dedicado a uma coisa só reduz o número de decisões durante a tarefa: você já escolheu o que fazer e por quanto tempo. Aqui, o bloco dura 50 minutos.</p>
    <p>Cinquenta minutos não é uma regra. É um tamanho possível para trabalho que pede continuidade, como escrever, ler um capítulo ou resolver uma parte concreta de um projeto. Se a sua tarefa cabe em menos, use menos; se pede mais, divida em blocos com descanso entre eles.</p>
    <h2>De onde vem a ideia</h2>
    <p>Blocos cronometrados ficaram conhecidos pela Técnica Pomodoro, que alterna períodos de foco e pausas curtas. O princípio por trás é simples: um limite visível torna mais fácil começar e mais fácil parar. O Acalmo usa a mesma ideia com um bloco mais longo e sem placar: não há pontos, sequência de dias nem cobrança para voltar.</p>
    <h2>Como usar aqui</h2>
    <p>Escolha uma tarefa concreta antes de começar. Deixe por perto o que ela precisa e afaste o que desvia a atenção, se isso for possível. Toque em começar; o relógio conta o tempo restante. Pause quando precisar e recomece se quiser zerar. Ao final, o bloco termina e o descanso faz parte do ritmo.</p>
    <p>Um fundo sonoro suave, como chuva ou ruído marrom, pode acompanhar o bloco se isso ajudar você. Mantenha o volume confortável e lembre de que o silêncio também funciona.</p>
    <h2>Depois do bloco</h2>
    <p>Pare antes de escolher o próximo bloco. Levante, beba água, olhe pela janela ou faça uma pausa curta de respiração. Encadear blocos sem descanso transforma a técnica em mais uma cobrança, que é o oposto do propósito.</p>
    <h2>O que ele não faz</h2>
    <p>Um temporizador não garante produtividade nem trata dificuldade de atenção. Ele apenas oferece um limite claro para uma tarefa. Se a concentração for um problema persistente e angustiante, vale conversar com um profissional em vez de aumentar o tempo do bloco.</p>
    <div class="article-source"><p>Referências: <a href="https://www.pomodorotechnique.com/" target="_blank" rel="noopener noreferrer">The Pomodoro Technique</a>, de Francesco Cirillo, e <a href="https://www.healthline.com/health/mental-health/how-to-improve-concentration" target="_blank" rel="noopener noreferrer">Healthline — how to improve concentration</a>. O texto do Acalmo é editorial, sem promessa de resultado.</p></div>`
  }
];

for (const tool of tools) {
  const dir = path.join(root, tool.route);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), page(tool));
}
const sitemapPath = path.join(root, 'sitemap.xml');
let sitemap = await readFile(sitemapPath, 'utf8');
const toolUrls = tools.map(tool => `<url><loc>${origin}${tool.route}</loc></url>`).join('');
sitemap = sitemap.replace('</urlset>', toolUrls + '</urlset>');
await writeFile(sitemapPath, sitemap);
console.log(`${tools.length} páginas-ferramenta com cena própria preparadas e incluídas no sitemap.`);