/*---------------------------------------------------------------------------------------------
 *  Jarvis Forge overlay - the Lens pill.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import './media/jarvisLensPill.css';

/*
	A floating glass capsule over the editor area: idle mark, working stage ring,
	needs-you pulse. Click (or Ctrl+J) focuses the Jarvis Lens.

	Why this lives in core rather than in the extension: nothing in the extension
	API can paint over the editor part. The extension still owns every decision -
	it publishes its state as four context keys and this contribution renders
	whatever they say. That keeps the patch to "read four keys, draw a pill" with
	no new IPC channel, no new service and no daemon knowledge in the workbench.

	Gated on product.json's `forgeGlassWindow`, the same flag patch 0004 uses, so
	an unbranded build behaves exactly like upstream.
*/

const enum LensKeys {
	State = 'jarvis.lens.state',
	Label = 'jarvis.lens.label',
	Detail = 'jarvis.lens.detail',
	Progress = 'jarvis.lens.progress'
}

const WATCHED = new Set<string>([LensKeys.State, LensKeys.Label, LensKeys.Detail, LensKeys.Progress]);

/** Fallback offset when the editor group has no title control (no tabs). */
const NO_TITLE_OFFSET = 8;

class JarvisLensPill extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.jarvisLensPill';

	private pill: HTMLElement | undefined;
	private dot: HTMLElement | undefined;
	private labelNode: HTMLElement | undefined;
	private detailNode: HTMLElement | undefined;
	private lastSignature = '';

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ICommandService private readonly commandService: ICommandService,
		@IProductService productService: IProductService
	) {
		super();

		if (!productService.forgeGlassWindow) {
			return;
		}

		const container = this.layoutService.getContainer(mainWindow, Parts.EDITOR_PART);
		if (!container) {
			return;
		}

		this.create(container);
		this.render();

		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(WATCHED)) {
				this.render();
			}
		}));

		// The pill hangs below the editor group's title control, whose height
		// depends on tabs, breadcrumbs and the density setting. Measure it rather
		// than hardcoding a number that a settings change would falsify.
		const observer = new ResizeObserver(() => this.position());
		observer.observe(container);
		this._register(toDisposable(() => observer.disconnect()));
	}

	private create(container: HTMLElement): void {
		const host = append(container, $('.jarvis-lens-host'));
		const pill = append(host, $('button.jarvis-lens-pill'));
		pill.tabIndex = 0;
		pill.setAttribute('type', 'button');

		this.dot = append(pill, $('.jarvis-lens-dot'));
		const text = append(pill, $('.jarvis-lens-text'));
		this.labelNode = append(text, $('.jarvis-lens-label'));
		this.detailNode = append(text, $('.jarvis-lens-detail'));
		this.pill = pill;

		this._register(addDisposableListener(pill, EventType.CLICK, () => {
			this.commandService.executeCommand('jarvis.lens.focus');
		}));

		this._register(toDisposable(() => host.remove()));
	}

	private position(): void {
		const pill = this.pill;
		if (!pill) {
			return;
		}
		const container = this.layoutService.getContainer(mainWindow, Parts.EDITOR_PART);
		const title = container?.querySelector('.editor-group-container > .title');
		const height = title instanceof HTMLElement ? title.offsetHeight : 0;
		// Inline style on purpose: the offset is measured, and the fork's
		// stylelint rejects a custom property of our own to carry it. A margin
		// rather than `top` so the host's flex centring keeps working and the
		// hover transform stays free.
		pill.style.marginTop = (height > 0 ? height + NO_TITLE_OFFSET : NO_TITLE_OFFSET) + 'px';
	}

	private render(): void {
		const pill = this.pill;
		if (!pill || !this.dot || !this.labelNode || !this.detailNode) {
			return;
		}

		const state = this.contextKeyService.getContextKeyValue<string>(LensKeys.State) ?? 'offline';
		const label = this.contextKeyService.getContextKeyValue<string>(LensKeys.Label) ?? 'Jarvis';
		const detail = this.contextKeyService.getContextKeyValue<string>(LensKeys.Detail) ?? '';
		const progress = this.contextKeyService.getContextKeyValue<number>(LensKeys.Progress) ?? 0;

		const signature = state + '|' + label + '|' + detail + '|' + progress;
		if (signature === this.lastSignature) {
			return;
		}
		this.lastSignature = signature;

		pill.classList.remove('state-offline', 'state-idle', 'state-working', 'state-attention');
		pill.classList.add('state-' + state);
		pill.title = detail ? label + ' - ' + detail : label;
		pill.setAttribute('aria-label', 'Jarvis: ' + pill.title);

		this.labelNode.textContent = label;
		this.detailNode.textContent = detail;

		// The stage ring: a conic sweep around the dot. Inline because the angle
		// is data, and a CSS custom property of ours would fail the fork's
		// stylelint (see apps/forge-vscode/patches/README.md).
		const angle = Math.max(0, Math.min(100, progress)) * 3.6;
		this.dot.style.backgroundImage = state === 'working' || state === 'attention'
			? 'conic-gradient(currentColor ' + angle + 'deg, rgba(127, 127, 127, 0.25) ' + angle + 'deg)'
			: '';

		this.position();
	}
}

registerWorkbenchContribution2(JarvisLensPill.ID, JarvisLensPill, WorkbenchPhase.AfterRestored);
