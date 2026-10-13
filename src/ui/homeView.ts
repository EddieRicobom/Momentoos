import { h } from './dom';
import { statusChip } from './components';
import type { View } from './context';

interface MenuItem {
  title: string;
  hint: string;
  run(): void;
}

export const homeView: View = (context, root) => {
  const chip = statusChip(context.store);

  const items: MenuItem[] = [
    {
      title: 'Meus projetos',
      hint: 'Projetos guardados no aparelho',
      run: () =>
        context.toast(
          'Ainda não disponível: projetos salvos no aparelho chegam na Etapa C. Por enquanto o alvo existe só enquanto o app está aberto.',
        ),
    },
    {
      title: 'Criar âncora',
      hint: 'Foto da tatuagem → alvo de rastreamento',
      run: () => context.navigate('create'),
    },
    {
      title: 'Abrir câmera',
      hint: 'Procurar a tatuagem e ver o objeto virtual',
      run: () => {
        if (!context.getTarget()) {
          context.toast('Crie uma âncora primeiro: a câmera precisa de um alvo.');
          context.navigate('create');
          return;
        }
        context.navigate('camera');
      },
    },
    {
      title: 'Importar projeto',
      hint: 'Trazer um backup de outro aparelho',
      run: () =>
        context.toast(
          'Ainda não disponível: importação de backup (ZIP) chega na Etapa C. Hoje você pode carregar um alvo .mind em "Criar âncora".',
        ),
    },
    {
      title: 'Exportar backup',
      hint: 'Levar seus projetos para outro aparelho',
      run: () =>
        context.toast(
          'Ainda não disponível: backup em ZIP chega na Etapa C. Hoje você pode baixar o alvo .mind em "Criar âncora".',
        ),
    },
    {
      title: 'Configurações',
      hint: 'Compatibilidade, privacidade e dados locais',
      run: () => context.navigate('settings'),
    },
  ];

  const list = h(
    'ul',
    { class: 'menu' },
    ...items.map((item) =>
      h(
        'li',
        null,
        h(
          'button',
          { class: 'menu-item', type: 'button', onclick: item.run },
          h('span', { class: 'menu-title' }, item.title),
          h('span', { class: 'menu-hint' }, item.hint),
        ),
      ),
    ),
  );

  root.append(
    h(
      'main',
      { class: 'screen' },
      h(
        'header',
        { class: 'hero' },
        h('h1', { class: 'hero-title' }, 'Tattoo AR'),
        h(
          'p',
          { class: 'hero-sub' },
          'Conteúdo digital preso à sua tatuagem, reconhecida pela câmera. Tudo roda neste aparelho: nenhuma foto sai daqui.',
        ),
        chip.element,
      ),
      list,
      h(
        'p',
        { class: 'footnote' },
        'Protótipo em desenvolvimento (Etapas A e B). O reconhecimento em tatuagens reais ainda precisa ser testado no celular: veja docs/TESTES-MANUAIS.md.',
      ),
    ),
  );

  return () => chip.destroy();
};
