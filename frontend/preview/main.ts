import '../src/maxsen-home-panel.ts';
import type { MaxsenHomePanel } from '../src/maxsen-home-panel.ts';
import type { HomePackage } from '../src/types.ts';
import fixture from '../../tests/fixtures/home-v1.json';
import { createFakeHass } from './fake-hass.ts';
import { PackageProblem, parseHomeFile } from './validate-package.ts';

// Home Assistant's own menu button, which the narrow panel header uses.
if (!customElements.get('ha-menu-button')) {
  customElements.define(
    'ha-menu-button',
    class extends HTMLElement {
      connectedCallback(): void {
        this.textContent = '☰';
        this.style.cssText = 'font-size:22px;line-height:1;padding:0 8px;cursor:default';
      }
    },
  );
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
}

const frame = byId<HTMLDivElement>('frame');
const status = byId<HTMLDivElement>('status');
const homeFile = byId<HTMLInputElement>('home-file');
const plannerFile = byId<HTMLInputElement>('planner-file');
const adminBox = byId<HTMLInputElement>('admin');
const installerBox = byId<HTMLInputElement>('installer');

const fake = createFakeHass(fixture as unknown as HomePackage, {
  admin: adminBox.checked,
  installerMode: installerBox.checked,
});

function say(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

const sayLoaded = (title: string, how: string): void =>
  say(`Showing “${title}” ${how}. Tap a light or switch to try it.`);

// ---- the real panel, given the fake hass ----

const panel = document.createElement('maxsen-home-panel') as MaxsenHomePanel;
// An empty config, so the panel finds its home with config_entries/get as it does in Home Assistant.
panel.panel = { config: {} };
/** Home Assistant hands out a new `hass` object on every change; the fake does the same on a copy. */
const refreshHass = (): void => {
  panel.hass = { ...fake };
};
fake.onChange(refreshHass);
refreshHass();
frame.append(panel);
fake.startSimulation();
sayLoaded('Test House', '(the sample home)');

// Home Assistant's shell opens a more-info dialog for these; the preview just says so.
window.addEventListener('hass-more-info', (event) => {
  const entityId = (event as CustomEvent<{ entityId: string }>).detail.entityId;
  const state = fake.states[entityId];
  const name = state?.attributes['friendly_name'];
  say(`Home Assistant would open the details for ${typeof name === 'string' ? name : entityId} (${state?.state ?? 'unknown'}).`);
});

// ---- toolbar ----

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="frame"]')) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    frame.className = `frame ${radio.value}`;
    panel.narrow = radio.value === 'phone';
  });
}

adminBox.addEventListener('change', () => fake.setAdmin(adminBox.checked));
installerBox.addEventListener('change', () => fake.setInstallerMode(installerBox.checked));

/** Read the chosen file as a home package, or say what is wrong with it. */
async function readHomeFile(input: HTMLInputElement): Promise<HomePackage | undefined> {
  const file = input.files?.[0];
  input.value = ''; // so choosing the same file again still counts
  if (!file) return undefined;
  try {
    return parseHomeFile(await file.text(), file.size);
  } catch (error) {
    say(
      error instanceof PackageProblem ? error.message : `Could not read ${file.name}.`,
      true,
    );
    return undefined;
  }
}

homeFile.addEventListener('change', async () => {
  const pkg = await readHomeFile(homeFile);
  if (!pkg) return;
  try {
    fake.openHome(pkg);
  } catch (error) {
    console.error(error);
    say(
      `That file passed the checks but the preview could not build a home from it, so the previous home is still shown. (${error instanceof Error ? error.message : String(error)})`,
      true,
    );
    return;
  }
  sayLoaded(pkg.project.title, 'from your file');
});

plannerFile.addEventListener('change', async () => {
  const pkg = await readHomeFile(plannerFile);
  if (!pkg) return;
  fake.setPlannerPackage(pkg);
  say(`The pretend planner now has “${pkg.project.title}”. In the Installer tools, Refresh from planner shows what changes.`);
});
