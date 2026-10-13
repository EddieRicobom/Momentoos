import { checkCapabilities } from '../capabilities';
import { getStorageInfo, requestPersistence, type StorageInfo } from '../storage/storageInfo';
import { topBar } from './components';
import type { View } from './context';
import { formatBytes, h } from './dom';

export const settingsView: View = (context, root) => {
  const capabilities = checkCapabilities();
  let disposed = false;

  const usageLine = h('p', { class: 'muted' }, 'Verificando o uso de armazenamento…');
  const persistLine = h('p', { class: 'muted' });
  const persistResult = h('p', { class: 'muted', role: 'status' });
  persistResult.hidden = true;
  const persistButton = h(
    'button',
    { class: 'btn', type: 'button', onclick: () => void askPersistence() },
    'Pedir armazenamento persistente',
  );
  persistButton.hidden = true;

  function showInfo(info: StorageInfo): void {
    if (disposed) return;
    usageLine.textContent =
      info.usage !== null && info.quota !== null
        ? `Este app usa cerca de ${formatBytes(info.usage)} de aproximadamente ${formatBytes(info.quota)} que o navegador permite (valores estimados pelo próprio navegador).`
        : 'O navegador não informa o uso de armazenamento.';
    if (info.persisted === true) {
      persistLine.textContent =
        'Armazenamento persistente: concedido. O navegador não deve apagar os dados por falta de espaço, mas você ainda pode limpá-los manualmente.';
    } else if (info.persisted === false) {
      persistLine.textContent =
        'Armazenamento persistente: não concedido. Em caso de pouco espaço, o navegador pode apagar os dados deste site sem avisar.';
    } else {
      persistLine.textContent = 'Este navegador não informa se o armazenamento é persistente.';
    }
    persistButton.hidden = !(info.canRequestPersistence && info.persisted !== true);
  }

  async function askPersistence(): Promise<void> {
    persistButton.disabled = true;
    const result = await requestPersistence();
    if (disposed) return;
    persistResult.hidden = false;
    if (result.status === 'granted') {
      persistResult.textContent = 'O navegador concedeu o armazenamento persistente.';
    } else if (result.status === 'denied') {
      persistResult.textContent =
        'O navegador não concedeu. Isso é decisão dele e pode mudar com o uso do app (por exemplo, depois de instalá-lo na tela inicial). Continue fazendo backups.';
    } else if (result.status === 'unsupported') {
      persistResult.textContent = 'Este navegador não permite pedir armazenamento persistente.';
    } else {
      persistResult.textContent = `Não foi possível pedir: ${result.message}`;
    }
    persistButton.disabled = false;
    showInfo(await getStorageInfo());
  }

  void getStorageInfo().then(showInfo);

  root.append(
    h(
      'main',
      { class: 'screen' },
      topBar('Configurações', () => context.navigate('home')),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Compatibilidade deste navegador'),
        h(
          'ul',
          { class: 'checks' },
          ...capabilities.map((item) =>
            h(
              'li',
              { class: 'check', 'data-ok': item.ok ? 'true' : 'false' },
              h('span', { class: 'check-mark', 'aria-hidden': 'true' }, item.ok ? '✓' : '✕'),
              h(
                'span',
                null,
                h('strong', null, item.label),
                h('span', { class: 'muted block' }, item.detail),
              ),
            ),
          ),
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Privacidade'),
        h(
          'p',
          { class: 'muted' },
          'Fotos, alvos e projetos ficam neste aparelho. O app não envia imagens para ninguém, não tem conta, não usa telemetria nem anúncios. A câmera só é pedida quando você abre a tela da câmera.',
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Funcionamento offline'),
        h(
          'p',
          { class: 'muted' },
          'Ainda não disponível: o modo offline (instalação como app) chega na Etapa E. Hoje o app precisa de internet para ser aberto. Depois de aberto, compilar o alvo e rastrear acontecem no aparelho, sem rede.',
        ),
        h(
          'p',
          { class: 'muted' },
          'Vídeos incorporados do YouTube (Etapa D) vão depender de internet e das regras do próprio YouTube.',
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Dados locais e backup'),
        h(
          'p',
          { class: 'muted' },
          'Os projetos ficam no armazenamento local deste navegador (IndexedDB). Limpar os dados do navegador ou do site, ou desinstalar o app, apaga tudo. Exporte um backup de vez em quando.',
        ),
        usageLine,
        persistLine,
        persistButton,
        persistResult,
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('export') }, 'Exportar backup'),
          h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('import') }, 'Importar backup'),
        ),
      ),
    ),
  );

  return () => {
    disposed = true;
  };
};
