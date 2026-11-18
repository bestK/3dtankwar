import './styles/main.css';
import { GameApp, GameUiBridge, HudSnapshot } from './GameApp';
import { isValidModSelection, loadVehicleMod, parseMod, VEHICLE_MODS } from './mod/ModCatalog';
import { computeBrowserFingerprint } from './net/Fingerprint';
import { VoiceChat } from './net/VoiceChat';
import { PeerPresence, PublicRoomBeacon, TileType } from './types';

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

function $all(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector));
}

window.addEventListener('DOMContentLoaded', () => {
  const canvasRoot = $('#canvas-root')!;

  // Top Tactical Bar
  const hudTop = $('#hud-top')!;
  const btnHome = $('#btn-home')!;
  const hudStagePill = $('#hud-stage-pill')!;
  const hudEnemyStrip = $('#hud-enemy-strip')!;
  const hudRoomChip = $('#hud-room-chip')!;
  const hudRoomCode = $('#hud-room-code')!;
  const hudNetDot = $('#hud-net-dot')!;
  const hudNetPing = $('#hud-net-ping')!;
  const btnCopyRoom = $('#btn-copy-room')!;
  const hudScoreboard = $('#hud-scoreboard')!;

  const hudHpFill = $('#hud-hp-fill')!;
  const hudLives = $('#hud-lives')!;
  const hudStars = $('#hud-stars')!;
  const hudScore = $('#hud-score')!;

  const btnCamera = $('#btn-camera')!;
  const btnSlowmo = $('#btn-slowmo')!;
  const btnAudio = $('#btn-audio')!;
  const btnVoiceHud = $('#btn-voice')!;
  const btnMuteHud = $('#btn-mute')!;
  const btnSettings = $('#btn-settings')!;
  const settingsPopover = $('#settings-popover')!;
  const rangeTurretSpeed = $('#range-turret-speed') as HTMLInputElement;
  const turretSpeedValue = $('#turret-speed-value')!;

  // Touch / mobile
  const isTouchUi =
    window.matchMedia('(pointer: coarse)').matches ||
    (navigator.maxTouchPoints > 0 && window.matchMedia('(hover: none)').matches);
  document.body.classList.toggle('is-touch', isTouchUi);
  const mobileControls = $('#mobile-controls')!;
  const stickMove = $('#stick-move')!;
  const stickMoveKnob = $('#stick-move-knob')!;
  const stickAim = $('#stick-aim')!;
  const stickAimKnob = $('#stick-aim-knob')!;
  const btnTouchFire = $('#btn-touch-fire')!;
  const rotateHint = $('#rotate-hint')!;
  const btnRotate = $('#btn-rotate')!;
  const btnRotateDismiss = $('#btn-rotate-dismiss')!;
  const btnChatMobile = $('#btn-chat-mobile')!;
  const btnChatLobby = $('#btn-chat-lobby')!;
  const btnFullscreen = $('#btn-fullscreen')!;

  // Charge Bar & Toasts
  const chargeWrap = $('#charge-bar-wrap')!;
  const chargeFill = $('#charge-bar-fill')!;
  const eventFeed = $('#event-feed')!;

  // In-Battle Chat & Voice
  const chatLog = $('#chat-log')!;
  const chatBar = $('#chat-bar')!;
  const chatInput = $('#chat-input') as HTMLInputElement;
  const voiceToggles = $all('.voice-toggle');
  const voiceMutes = $all('.voice-mute');
  const voiceAudioRoot = $('#voice-audio-root')!;
  const voiceSpeakingChip = $('#voice-speaking')!;
  const voiceSpeakingNames = $('#voice-speaking-names')!;

  // Workshop Sculpting Palette
  const workshopBar = $('#workshop-bar')!;
  const brushButtons = $all('.brush-chip');
  const btnWsTemplate = $('#btn-ws-template')!;
  const btnWsClear = $('#btn-ws-clear')!;
  const btnWsPlay = $('#btn-ws-play')!;

  // Hero & Online Lobby
  const heroOverlay = $('#hero-overlay')!;
  const btnBrokerToggle = $('#btn-broker-toggle')!;
  const brokerPopover = $('#broker-popover')!;
  const selectBrokerUrl = $('#select-broker-url') as HTMLSelectElement;
  const btnBrokerReconnect = $('#btn-broker-reconnect')!;
  const inputTurnUrl = $('#input-turn-url') as HTMLInputElement;
  const inputTurnUser = $('#input-turn-user') as HTMLInputElement;
  const inputTurnPass = $('#input-turn-pass') as HTMLInputElement;
  const netLed = $('#net-led')!;
  const netLabel = $('#net-label')!;
  const netPing = $('#net-ping')!;

  const modeTabs = $all('.mode-tab');
  const panelCampaign = $('#panel-campaign')!;
  const panelOnline = $('#panel-online')!;
  const panelWorkshop = $('#panel-workshop')!;

  const selectMod = $('#select-mod') as HTMLSelectElement;
  const selectModHud = $('#select-mod-hud') as HTMLSelectElement;
  const btnModFlip = $('#btn-mod-flip')!;
  const btnModFlipHud = $('#btn-mod-flip-hud')!;
  for (const select of [selectMod, selectModHud]) {
    VEHICLE_MODS.forEach((mod) => {
      const option = document.createElement('option');
      option.value = mod.id;
      option.textContent = mod.label;
      select.appendChild(option);
    });
  }

  const campaignStageButtons = $all('.stage-pill');
  const btnStartCampaign = $('#btn-start-campaign')!;

  const inputCallsign = $('#input-callsign') as HTMLInputElement;
  const inputRoom = $('#input-room') as HTMLInputElement;
  const btnJoinRoom = $('#btn-join-room')!;
  const btnQuickMatch = $('#btn-quick-match')!;
  const btnShareLink = $('#btn-share-link')!;
  const pvpMapButtons = $all('.pvp-map-pill');
  const activeRoomsStrip = $('#active-rooms-strip')!;
  const lobbyRoster = $('#lobby-roster')!;
  const btnStartOnline = $('#btn-start-online')!;

  const btnEnterWorkshop = $('#btn-enter-workshop')!;

  // Result Modal
  const resultModal = $('#result-modal')!;
  const resultTitle = $('#result-title')!;
  const resultStats = $('#result-stats')!;
  const btnResultNext = $('#btn-result-next')!;
  const btnResultMenu = $('#btn-result-menu')!;

  // Vote kick & fingerprint ban
  const votePanel = $('#vote-panel')!;
  const voteTitle = $('#vote-title')!;
  const voteDetail = $('#vote-detail')!;
  const btnVoteYes = $('#btn-vote-yes') as HTMLButtonElement;
  const btnVoteNo = $('#btn-vote-no') as HTMLButtonElement;
  const banBanner = $('#ban-banner')!;
  let activeVoteId = '';

  let currentSelectedMode: 'campaign' | 'pvp' | 'coop' | 'workshop' = 'campaign';
  let selectedCampaignStage = 0;
  let selectedPvpMap = 0;
  let canNextStageAction = false;

  const showToast = (msg: string) => {
    const toast = document.createElement('div');
    toast.className = 'feed-toast';
    toast.textContent = msg;
    eventFeed.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2900);
  };

  const addChatMessage = (name: string, text: string, self: boolean) => {
    const line = document.createElement('div');
    line.className = `chat-line${self ? ' self' : ''}`;
    const who = document.createElement('span');
    who.className = 'chat-name';
    who.textContent = name;
    const body = document.createElement('span');
    body.className = 'chat-text';
    body.textContent = text;
    line.append(who, body);
    chatLog.appendChild(line);
    while (chatLog.children.length > 6) chatLog.firstElementChild?.remove();
  };

  const openChat = () => {
    if (chatBar.classList.contains('hidden')) {
      chatInput.value = '';
      chatBar.classList.remove('hidden');
    }
    chatInput.focus();
  };

  const closeChat = () => {
    chatBar.classList.add('hidden');
    chatInput.blur();
  };

  const peerNames = new Map<string, string>();
  const speakingPeers = new Set<string>();

  const applySpeakingHighlights = () => {
    document.querySelectorAll<HTMLElement>('[data-peer]').forEach((el) => {
      el.classList.toggle('speaking', speakingPeers.has(el.dataset.peer || ''));
    });
    const names = [...speakingPeers].map((id) => peerNames.get(id) || '玩家');
    voiceSpeakingNames.textContent = names.join('、');
    voiceSpeakingChip.classList.toggle('hidden', names.length === 0);
  };

  const addKickButton = (parent: HTMLElement, peerId: string, label = '投票') => {
    if (peerId === app.net.peerId) return;
    const kick = document.createElement('button');
    kick.className = 'kick-btn';
    kick.textContent = label;
    kick.title = '发起投票踢出该玩家，通过后 10 分钟内禁止其浏览器进入';
    kick.onclick = (e) => {
      e.stopPropagation();
      if (!app.startVoteKick(peerId)) showToast('当前已有投票进行中');
    };
    parent.appendChild(kick);
  };

  const setVoiceUi = (state: { active: boolean; pending: boolean; muted: boolean }) => {
    const label = state.pending ? '连接中…' : state.active ? '语音中' : '语音';
    voiceToggles.forEach((btn) => {
      btn.textContent = label;
      btn.classList.toggle('active', state.active && !state.pending);
      (btn as HTMLButtonElement).disabled = state.pending;
    });
    voiceMutes.forEach((btn) => {
      btn.classList.toggle('hidden', !state.active);
      btn.textContent = state.muted ? '开麦' : '闭麦';
      btn.classList.toggle('active', state.muted);
    });
    if (!state.active && !state.pending) {
      speakingPeers.clear();
      applySpeakingHighlights();
    }
  };

  const isOnlineLobby = () =>
    !heroOverlay.classList.contains('hidden') &&
    (currentSelectedMode === 'pvp' || currentSelectedMode === 'coop');

  const copyRoomLink = (roomId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    url.searchParams.set('mode', currentSelectedMode === 'coop' ? 'coop' : 'pvp');
    navigator.clipboard
      ?.writeText(url.toString())
      .then(() => showToast(`邀请链接已复制: #${roomId}`))
      .catch(() => {
        prompt('请复制邀请链接：', url.toString());
      });
  };

  const uiBridge: GameUiBridge = {
    onHudUpdate: (hud: HudSnapshot) => {
      if (hud.mode === 'demo') {
        hudTop.classList.add('hidden');
        chargeWrap.classList.add('hidden');
        mobileControls.classList.add('hidden');
        document.body.classList.remove('mobile-combat');
        if (!chatBar.classList.contains('hidden')) closeChat();
        if (chatLog.firstChild) chatLog.innerHTML = '';
        return;
      }
      hudTop.classList.remove('hidden');

      const touchCombat =
        (hud.mode === 'campaign' || hud.mode === 'pvp' || hud.mode === 'coop') && !app.matchEnded;
      mobileControls.classList.toggle('hidden', !touchCombat);
      document.body.classList.toggle('mobile-combat', touchCombat);

      // Voice is an online-room feature only
      const voiceAvailable = hud.mode === 'pvp' || hud.mode === 'coop';
      btnVoiceHud.classList.toggle('hidden', !voiceAvailable);
      btnMuteHud.classList.toggle('hidden', !voiceAvailable || !app.voice.active);

      // Stage & wave
      if (hud.mode === 'campaign' || hud.mode === 'coop') {
        hudStagePill.textContent = `第 0${hud.stageIndex + 1} 关`;
        hudStagePill.classList.remove('hidden');
        hudEnemyStrip.classList.remove('hidden');

        // Draw remaining enemy pips
        hudEnemyStrip.innerHTML = '';
        for (let i = 0; i < Math.min(20, hud.enemyWaveLeft); i++) {
          const pip = document.createElement('span');
          pip.className = 'enemy-pip' + (i % 4 === 1 ? ' heavy' : '');
          hudEnemyStrip.appendChild(pip);
        }
      } else {
        hudStagePill.classList.add('hidden');
        hudEnemyStrip.classList.add('hidden');
      }

      // Online Room Badge
      if (hud.mode === 'pvp' || hud.mode === 'coop') {
        hudRoomChip.classList.remove('hidden');
        hudRoomCode.textContent = `#${app.net.roomId}`;
      } else {
        hudRoomChip.classList.add('hidden');
      }

      // Player stats
      const hpPct = Math.max(0, Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100));
      hudHpFill.style.width = `${hpPct}%`;
      hudHpFill.classList.toggle('low', hpPct <= 34);

      hudLives.innerHTML =
        hud.mode === 'pvp'
          ? `PVP`
          : `<span>♥</span>×${Math.max(0, hud.lives)}`;

      hudStars.textContent = '★'.repeat(Math.max(1, Math.min(3, hud.stars)));
      hudScore.textContent = hud.score.toString().padStart(6, '0');

      // Charge bar
      if (hud.chargeRatio > 0.05) {
        chargeWrap.classList.remove('hidden');
        chargeFill.style.width = `${Math.min(100, Math.round(hud.chargeRatio * 100))}%`;
      } else {
        chargeWrap.classList.add('hidden');
      }

      // Tool buttons
      btnCamera.textContent =
        hud.cameraPreset === 'diorama'
          ? '沙盘视角'
          : hud.cameraPreset === 'chase'
            ? '追尾视角'
            : '自由环视';
      btnSlowmo.classList.toggle('active', hud.slowMo);
    },

    onNetStatus: (st, url, ping) => {
      netLed.className = `net-dot ${st}`;
      hudNetDot.className = `net-dot ${st}`;

      try {
        const u = new URL(url);
        netLabel.textContent = u.hostname || 'broker.emqx.io';
      } catch {
        netLabel.textContent = 'broker.emqx.io';
      }

      const pingStr = ping !== null ? `${ping}ms` : '--';
      netPing.textContent = pingStr;
      hudNetPing.textContent = pingStr;
    },

    onRosterUpdate: (peers: PeerPresence[], hostId: string | null) => {
      // Lobby roster
      lobbyRoster.innerHTML = '';
      peers.forEach((p) => {
        const item = document.createElement('div');
        item.className = 'lobby-player' + (p.peerId === hostId ? ' host' : '');
        item.dataset.peer = p.peerId;
        const colHex = '#' + p.color.toString(16).padStart(6, '0');
        item.innerHTML = `<span class="swatch" style="background:${colHex}"></span><span>${p.name}${p.peerId === app.net.peerId ? ' (你)' : ''}</span>${p.peerId === hostId ? ' 👑' : ''}`;
        addKickButton(item, p.peerId);
        lobbyRoster.appendChild(item);
      });

      // Combat HUD scoreboard (PvP and Co-op)
      if (app.mode === 'pvp' || app.mode === 'coop') {
        hudScoreboard.classList.remove('hidden');
        hudScoreboard.innerHTML = '';
        peers.forEach((p) => {
          const pill = document.createElement('div');
          pill.className = 'roster-pill';
          pill.dataset.peer = p.peerId;
          const colHex = '#' + p.color.toString(16).padStart(6, '0');
          pill.innerHTML = `<span class="roster-swatch" style="background:${colHex}"></span><span>${p.name}</span><span class="roster-kills">${p.kills} 击毁</span>`;
          addKickButton(pill, p.peerId, '踢');
          hudScoreboard.appendChild(pill);
        });
      } else {
        hudScoreboard.classList.add('hidden');
      }

      peers.forEach((p) => peerNames.set(p.peerId, p.name));
      applySpeakingHighlights();
    },

    onPublicRooms: (rooms: PublicRoomBeacon[]) => {
      activeRoomsStrip.innerHTML = '';
      rooms.forEach((r) => {
        const btn = document.createElement('button');
        btn.className = 'room-beacon';
        btn.innerHTML = `<span>#${r.roomId}</span><span>[${r.mode === 'pvp' ? '死斗' : '守卫'}]</span><span>${r.count}人</span>`;
        btn.onclick = () => {
          if (!ensureCanEnter()) return;
          inputRoom.value = r.roomId;
          setModeTab(r.mode);
          joinRoomWithVoice(r.roomId, r.mode);
          closeChat();
          chatLog.innerHTML = '';
          showToast(`已切换至公开房间 #${r.roomId}`);
        };
        activeRoomsStrip.appendChild(btn);
      });
    },

    onToast: (msg: string) => {
      showToast(msg);
    },

    onMatchEnd: (victory: boolean, title: string, statsText: string, canNext: boolean) => {
      resultTitle.textContent = title;
      resultTitle.style.color = victory ? 'var(--brass-bright)' : 'var(--crimson-alert)';
      resultStats.textContent = statsText;
      canNextStageAction = canNext;
      btnResultNext.textContent = canNext ? '下一战区' : '重新出击';
      resultModal.classList.remove('hidden');
      mobileControls.classList.add('hidden');
      document.body.classList.remove('mobile-combat');
      resetTouchUi();
      closeChat();
    },

    onOnlineMatchStarted: (_mode: 'pvp' | 'coop') => {
      heroOverlay.classList.add('hidden');
      workshopBar.classList.add('hidden');
      resultModal.classList.add('hidden');
      closeChat();
      chatLog.innerHTML = '';
      beginTouchCombat();
    },

    onChatMessage: (name: string, text: string, self: boolean) => {
      if (!app.isCombatMode() && !isOnlineLobby()) return;
      addChatMessage(name, text, self);
    },

    onKicked: (msg: string, banUntil?: number) => {
      heroOverlay.classList.remove('hidden');
      workshopBar.classList.add('hidden');
      resultModal.classList.add('hidden');
      hudTop.classList.add('hidden');
      mobileControls.classList.add('hidden');
      document.body.classList.remove('mobile-combat');
      resetTouchUi();
      exitLandscape();
      votePanel.classList.add('hidden');
      closeChat();
      chatLog.innerHTML = '';
      const until = banUntil ?? Date.now() + BAN_MS;
      const applyBan = (fp: string) => banFingerprint(fp, until);
      if (browserFp) applyBan(browserFp);
      else {
        void computeBrowserFingerprint().then((fp) => {
          browserFp = fp;
          applyBan(fp);
        });
      }
      app.startHeroDemo();
      showToast(msg);
    },

    onFingerprintBan: (fp: string, until: number) => {
      banFingerprint(fp, until);
    },

    onVoteUpdate: (state) => {
      if (!state) {
        activeVoteId = '';
        votePanel.classList.add('hidden');
        return;
      }
      activeVoteId = state.voteId;
      votePanel.classList.remove('hidden');
      voteTitle.textContent = state.isInitiator
        ? `你发起投票踢出 ${state.targetName}`
        : `投票踢出 ${state.targetName}`;
      const remaining = Math.max(0, Math.ceil((state.until - Date.now()) / 1000));
      voteDetail.textContent = `同意 ${state.yes} / 需要 ${state.required} · 反对 ${state.no} · 剩余 ${remaining}s${state.voted ? ' · 你已投票' : ''}`;
      btnVoteYes.disabled = state.voted;
      btnVoteNo.disabled = state.voted;
    },
  };

  const app = new GameApp(canvasRoot, uiBridge);

  // ---- Mobile: fullscreen landscape + virtual sticks ----
  type LockableOrientation = ScreenOrientation & {
    lock?: (orientation: 'landscape') => Promise<void>;
    unlock?: () => void;
  };
  let orientationLocked = false;
  let lastLandscapeAttempt = 0;

  const enterLandscape = async (): Promise<void> => {
    if (!isTouchUi) return;
    const now = Date.now();
    if (now - lastLandscapeAttempt < 900) return;
    lastLandscapeAttempt = now;

    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      // Fullscreen is optional; the rotate hint still guides the player.
    }
    try {
      const orientation = screen.orientation as LockableOrientation | undefined;
      if (orientation?.lock) {
        await orientation.lock('landscape');
        orientationLocked = true;
      }
    } catch {
      // iOS Safari does not support orientation lock.
    }
  };

  const beginTouchCombat = (): void => {
    rotateHint.classList.remove('hidden');
    if (isTouchUi) showToast('左摇杆驾驶 · 右摇杆瞄准 · 开炮键长按蓄力');
    void enterLandscape();
  };

  const exitLandscape = (): void => {
    if (!isTouchUi) return;
    try {
      if (orientationLocked) (screen.orientation as LockableOrientation | undefined)?.unlock?.();
    } catch {
      // Ignore browsers that reject unlock.
    }
    orientationLocked = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };

  const resetTouchUi = (): void => {
    stickMoveKnob.style.transform = '';
    stickAimKnob.style.transform = '';
    btnTouchFire.classList.remove('active');
    app.releaseTouchInputs();
  };

  const setupStick = (
    zone: HTMLElement,
    knob: HTMLElement,
    onChange: (x: number, y: number) => void,
    deadzone = 0.18,
  ): void => {
    let pointerId: number | null = null;

    const apply = (clientX: number, clientY: number): void => {
      const rect = zone.getBoundingClientRect();
      const radius = Math.max(20, rect.width * 0.32);
      let dx = clientX - (rect.left + rect.width / 2);
      let dy = clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
      }
      knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      const nx = dx / radius;
      const ny = -dy / radius;
      const live = Math.hypot(nx, ny) >= deadzone;
      onChange(live ? nx : 0, live ? ny : 0);
    };

    const end = (id: number): void => {
      if (pointerId !== id) return;
      pointerId = null;
      knob.style.transform = '';
      onChange(0, 0);
    };

    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pointerId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      apply(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      apply(e.clientX, e.clientY);
    });
    zone.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      end(e.pointerId);
    });
    zone.addEventListener('pointercancel', (e) => {
      e.stopPropagation();
      end(e.pointerId);
    });
    zone.addEventListener('lostpointercapture', (e) => end(e.pointerId));
  };

  setupStick(stickMove, stickMoveKnob, (x, y) => app.setTouchMove(x, y));
  setupStick(stickAim, stickAimKnob, (x, y) => app.setTouchAim(x, y));

  let touchFireHeld = false;
  btnTouchFire.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (touchFireHeld) return;
    touchFireHeld = true;
    btnTouchFire.classList.add('active');
    btnTouchFire.setPointerCapture(e.pointerId);
    app.touchFireStart();
  });
  const endTouchFire = (e: PointerEvent): void => {
    if (!touchFireHeld) return;
    e.preventDefault();
    e.stopPropagation();
    touchFireHeld = false;
    btnTouchFire.classList.remove('active');
    app.touchFireEnd();
  };
  btnTouchFire.addEventListener('pointerup', endTouchFire);
  btnTouchFire.addEventListener('pointercancel', endTouchFire);
  btnTouchFire.addEventListener('lostpointercapture', endTouchFire);
  btnTouchFire.addEventListener('pointermove', (e) => {
    if (touchFireHeld) e.stopPropagation();
  });
  mobileControls.addEventListener('contextmenu', (e) => e.preventDefault());

  const canLockOrientation =
    typeof (screen.orientation as LockableOrientation | undefined)?.lock === 'function';
  btnRotate.onclick = () => {
    if (isTouchUi && !canLockOrientation) {
      rotateHint.classList.add('hidden');
      return;
    }
    void enterLandscape();
  };
  btnRotateDismiss.onclick = () => rotateHint.classList.add('hidden');
  btnFullscreen.onclick = () => void enterLandscape();
  if (isTouchUi && !canLockOrientation) {
    btnRotate.textContent = '知道了，手动横屏';
    btnRotateDismiss.classList.add('hidden');
    btnFullscreen.classList.add('hidden');
  }

  // If a match starts without a direct gesture (e.g. host launches remotely),
  // the first tap in combat promotes the page to fullscreen landscape.
  window.addEventListener(
    'pointerdown',
    () => {
      if (!isTouchUi || document.fullscreenElement || !app.isCombatMode()) return;
      void enterLandscape();
    },
    { passive: true },
  );

  // Fingerprint vote-ban (10 minutes, stored per browser)
  const BAN_KEY = 'agy_tank_bans_v1';
  const BAN_MS = 10 * 60 * 1000;
  type BanRecord = { fp: string; until: number };
  let browserFp = '';
  let banTicker: number | null = null;

  const loadBans = (): BanRecord[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(BAN_KEY) || '[]') as BanRecord[];
      const now = Date.now();
      return Array.isArray(raw)
        ? raw.filter((record) => record && typeof record.fp === 'string' && record.until > now)
        : [];
    } catch {
      return [];
    }
  };

  const saveBans = (bans: BanRecord[]) => {
    try {
      localStorage.setItem(BAN_KEY, JSON.stringify(bans));
    } catch {
      // Storage can be unavailable in private/incognito mode.
    }
  };

  const bannedUntilFor = (fp: string): number => {
    if (!fp) return 0;
    return loadBans().find((record) => record.fp === fp)?.until || 0;
  };

  const formatRemaining = (ms: number): string => {
    const total = Math.ceil(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  const updateBanBanner = () => {
    if (!browserFp) return;
    const until = bannedUntilFor(browserFp);
    const remaining = until - Date.now();
    if (remaining > 0) {
      banBanner.classList.remove('hidden');
      banBanner.textContent = `该浏览器已被投票移出，剩余 ${formatRemaining(remaining)} 后才能进入`;
      if (banTicker === null) banTicker = window.setInterval(updateBanBanner, 1000);
    } else {
      banBanner.classList.add('hidden');
      if (banTicker !== null) {
        clearInterval(banTicker);
        banTicker = null;
      }
    }
  };

  const banFingerprint = (fp: string, until: number) => {
    if (!fp) return;
    const bans = loadBans();
    const existing = bans.find((record) => record.fp === fp);
    if (existing) existing.until = Math.max(existing.until, until);
    else bans.push({ fp, until });
    saveBans(bans.filter((record) => record.until > Date.now()));
    app.net.banFingerprint(fp, until);
    if (fp === browserFp) updateBanBanner();
  };

  const ensureCanEnter = (): boolean => {
    if (browserFp && bannedUntilFor(browserFp) > Date.now()) {
      updateBanBanner();
      showToast('该浏览器仍处于踢出冷却中');
      return false;
    }
    return true;
  };

  void computeBrowserFingerprint().then((fp) => {
    browserFp = fp;
    app.net.setFingerprint(fp);
    for (const ban of loadBans()) app.net.banFingerprint(ban.fp, ban.until);
    updateBanBanner();
  });

  btnVoteYes.onclick = () => {
    if (activeVoteId) app.castVote(activeVoteId, true);
  };
  btnVoteNo.onclick = () => {
    if (activeVoteId) app.castVote(activeVoteId, false);
  };

  // In-battle chat
  let chatComposing = false;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    const canChat = app.isCombatMode() ? !app.matchEnded : isOnlineLobby();
    if (!canChat) return;
    e.preventDefault();
    openChat();
  });

  const openChatFromUi = (): void => {
    const canChat = app.isCombatMode() ? !app.matchEnded : isOnlineLobby();
    if (!canChat) return;
    openChat();
  };
  btnChatMobile.onclick = openChatFromUi;
  btnChatLobby.onclick = openChatFromUi;

  chatInput.addEventListener('compositionstart', () => {
    chatComposing = true;
  });
  chatInput.addEventListener('compositionend', () => {
    chatComposing = false;
  });
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && !chatComposing && e.keyCode !== 229) {
      e.preventDefault();
      const text = chatInput.value;
      chatInput.value = '';
      closeChat();
      app.sendChat(text, !app.isCombatMode() && isOnlineLobby());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      chatInput.value = '';
      closeChat();
    }
  });

  // Voice chat (WebRTC mesh, signaling over the room MQTT channel)
  app.voice.onStatusChange = setVoiceUi;
  app.voice.onRemoteStream = (peerId, stream) => {
    let audio = document.getElementById(`voice-audio-${peerId}`) as HTMLAudioElement | null;
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `voice-audio-${peerId}`;
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      voiceAudioRoot.appendChild(audio);
    }
    audio.srcObject = stream;
    void audio.play().catch(() => {
      // Autoplay can be blocked until the next user gesture.
    });
  };
  app.voice.onRemoteGone = (peerId) => {
    document.getElementById(`voice-audio-${peerId}`)?.remove();
    speakingPeers.delete(peerId);
    applySpeakingHighlights();
  };
  app.voice.onSpeakingChange = (peerId, speaking) => {
    if (speaking) speakingPeers.add(peerId);
    else speakingPeers.delete(peerId);
    applySpeakingHighlights();
  };
  setVoiceUi({ active: false, pending: false, muted: false });

  const toggleVoice = async () => {
    if (app.voice.active) {
      app.voice.disable();
      return;
    }
    if (app.voice.busy) return;
    if (!VoiceChat.supported) {
      showToast('当前浏览器不支持 WebRTC 语音');
      return;
    }
    try {
      await app.voice.enable();
      showToast('语音已开启');
    } catch {
      showToast('无法开启语音，请允许麦克风权限');
    }
  };

  voiceToggles.forEach((btn) => {
    btn.onclick = () => void toggleVoice();
  });
  voiceMutes.forEach((btn) => {
    btn.onclick = () => app.voice.toggleMute();
  });

  // Vehicle mod selection (applies to the player and is shared via presence)
  const MOD_KEY = 'agy_tank_mod';
  let currentMod = localStorage.getItem(MOD_KEY) || 'default';
  if (!isValidModSelection(currentMod)) currentMod = 'default';

  const applyModSelection = (selection: string, persist = true) => {
    const { mod, flip } = parseMod(selection);
    currentMod = mod ? `${mod.id}${flip ? ':flip' : ''}` : 'default';
    selectMod.value = mod?.id || 'default';
    selectModHud.value = mod?.id || 'default';
    for (const btn of [btnModFlip, btnModFlipHud]) {
      btn.classList.toggle('active', flip);
      (btn as HTMLButtonElement).disabled = !mod;
    }
    if (persist) localStorage.setItem(MOD_KEY, currentMod);
    app.setPlayerMod(currentMod);
    if (mod) void loadVehicleMod(currentMod);
  };

  const toggleModFlip = () => {
    const { mod, flip } = parseMod(currentMod);
    if (!mod) return;
    applyModSelection(`${mod.id}${flip ? '' : ':flip'}`);
  };

  applyModSelection(currentMod, false);
  selectMod.addEventListener('change', () => applyModSelection(selectMod.value));
  selectModHud.addEventListener('change', () => applyModSelection(selectModHud.value));
  btnModFlip.addEventListener('click', toggleModFlip);
  btnModFlipHud.addEventListener('click', toggleModFlip);

  const joinRoomWithVoice = (roomId: string, mode: 'pvp' | 'coop') => {
    const target = roomId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8) || '1985';
    if (app.net.roomId !== target) {
      app.voice.disable();
    }
    app.net.joinRoom(roomId, mode);
  };

  // TURN relay configuration (persisted per browser)
  const TURN_KEY = 'agy_tank_turn';
  const DEFAULT_TURN = {
    url: 'turn:120.24.190.16:3479?transport=udp turn:120.24.190.16:3479?transport=tcp',
    user: 'tankgame',
    pass: '4bd6023db768dc9e305cae90f47db609',
  };
  try {
    const savedTurn = JSON.parse(localStorage.getItem(TURN_KEY) || 'null') as {
      url?: string;
      user?: string;
      pass?: string;
    } | null;
    inputTurnUrl.value = savedTurn?.url ?? DEFAULT_TURN.url;
    inputTurnUser.value = savedTurn?.user ?? DEFAULT_TURN.user;
    inputTurnPass.value = savedTurn?.pass ?? DEFAULT_TURN.pass;
  } catch {
    inputTurnUrl.value = DEFAULT_TURN.url;
    inputTurnUser.value = DEFAULT_TURN.user;
    inputTurnPass.value = DEFAULT_TURN.pass;
  }

  const applyTurnConfig = () => {
    const raw = inputTurnUrl.value.trim();
    if (!raw) {
      app.voice.setTurnConfig(null);
      return;
    }
    const urls = raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((url) => (/^turns?:/i.test(url) ? url : `turn:${url}`));
    app.voice.setTurnConfig({
      urls: urls.length === 1 ? urls[0] : urls,
      username: inputTurnUser.value.trim() || undefined,
      credential: inputTurnPass.value || undefined,
    });
  };

  applyTurnConfig();
  const saveTurnConfig = () => {
    applyTurnConfig();
    localStorage.setItem(
      TURN_KEY,
      JSON.stringify({
        url: inputTurnUrl.value.trim(),
        user: inputTurnUser.value.trim(),
        pass: inputTurnPass.value,
      }),
    );
    if (app.voice.active) showToast('TURN 已更新，重新开启语音后生效');
  };
  [inputTurnUrl, inputTurnUser, inputTurnPass].forEach((input) => {
    input.addEventListener('change', saveTurnConfig);
  });

  // Set callsign field
  inputCallsign.value = app.net.callsign;
  inputCallsign.addEventListener('change', () => {
    app.net.setCallsign(inputCallsign.value);
  });

  // URL query params auto-join
  const urlParams = new URLSearchParams(window.location.search);
  const qRoom = urlParams.get('room');
  const qMode = urlParams.get('mode');
  if (qRoom) inputRoom.value = qRoom.slice(0, 8);
  if (qMode === 'pvp' || qMode === 'coop') {
    currentSelectedMode = qMode;
  }

  // Broker toggle & reconnect
  btnBrokerToggle.onclick = () => {
    brokerPopover.classList.toggle('hidden');
  };
  btnBrokerReconnect.onclick = () => {
    const url = selectBrokerUrl.value;
    app.net.connect(url);
    brokerPopover.classList.add('hidden');
    showToast(`正在重连 Broker: ${url}`);
  };

  // Mode Tabs Switching
  const setModeTab = (mode: 'campaign' | 'pvp' | 'coop' | 'workshop') => {
    currentSelectedMode = mode;
    modeTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-mode') === mode);
    });

    panelCampaign.classList.toggle('hidden', mode !== 'campaign');
    panelOnline.classList.toggle('hidden', mode !== 'pvp' && mode !== 'coop');
    panelWorkshop.classList.toggle('hidden', mode !== 'workshop');

    const pvpMapStrip = $('#pvp-map-strip');
    if (pvpMapStrip) {
      pvpMapStrip.classList.toggle('hidden', mode !== 'pvp');
    }

    if (mode === 'pvp' || mode === 'coop') {
      if (ensureCanEnter()) joinRoomWithVoice(inputRoom.value || '1985', mode);
    } else {
      if (app.voice.active) app.voice.disable();
      closeChat();
      chatLog.innerHTML = '';
    }
  };

  modeTabs.forEach((tab) => {
    tab.onclick = () => {
      const mode = tab.getAttribute('data-mode') as 'campaign' | 'pvp' | 'coop' | 'workshop';
      setModeTab(mode);
    };
  });
  setModeTab(currentSelectedMode);

  // Campaign Stage Pills
  campaignStageButtons.forEach((pill) => {
    pill.onclick = () => {
      campaignStageButtons.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      selectedCampaignStage = parseInt(pill.getAttribute('data-stage') || '0', 10);
    };
  });

  btnStartCampaign.onclick = () => {
    if (!ensureCanEnter()) return;
    heroOverlay.classList.add('hidden');
    workshopBar.classList.add('hidden');
    resultModal.classList.add('hidden');
    app.startCampaign(selectedCampaignStage);
    beginTouchCombat();
  };

  // PvP Map Selection
  pvpMapButtons.forEach((pill) => {
    pill.onclick = () => {
      pvpMapButtons.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      selectedPvpMap = parseInt(pill.getAttribute('data-pvpmap') || '0', 10);
    };
  });

  // Online Room Controls
  btnJoinRoom.onclick = () => {
    if (!ensureCanEnter()) return;
    const raw = inputRoom.value.trim() || '1985';
    joinRoomWithVoice(raw, currentSelectedMode === 'coop' ? 'coop' : 'pvp');
    closeChat();
    chatLog.innerHTML = '';
    showToast(`已进入房间 #${app.net.roomId}`);
  };

  btnQuickMatch.onclick = () => {
    if (!ensureCanEnter()) return;
    const publicList = app.net.getPublicRooms();
    if (publicList.length > 0) {
      const target = publicList[0];
      inputRoom.value = target.roomId;
      setModeTab(target.mode);
      joinRoomWithVoice(target.roomId, target.mode);
      closeChat();
      chatLog.innerHTML = '';
      showToast(`已匹配至活跃房间 #${target.roomId}`);
    } else {
      const randRoom = Math.floor(1000 + Math.random() * 8999).toString();
      inputRoom.value = randRoom;
      joinRoomWithVoice(randRoom, currentSelectedMode === 'coop' ? 'coop' : 'pvp');
      closeChat();
      chatLog.innerHTML = '';
      showToast(`已创建公开战区 #${randRoom}`);
    }
  };

  btnShareLink.onclick = () => copyRoomLink(app.net.roomId);
  btnCopyRoom.onclick = () => copyRoomLink(app.net.roomId);

  btnStartOnline.onclick = () => {
    if (!ensureCanEnter()) return;
    const isPvp = currentSelectedMode === 'pvp';
    app.hostStartOnlineMatch(isPvp ? 'pvp' : 'coop', isPvp ? selectedPvpMap : selectedCampaignStage);
    beginTouchCombat();
  };

  // Workshop Entry & Controls
  btnEnterWorkshop.onclick = () => {
    if (!ensureCanEnter()) return;
    heroOverlay.classList.add('hidden');
    workshopBar.classList.remove('hidden');
    hudTop.classList.add('hidden');
    resultModal.classList.add('hidden');
    closeChat();
    chatLog.innerHTML = '';
    app.enterWorkshop();
    showToast('沙盘工坊已就绪：左键绘制，右键360°旋转，Shift精细点选');
  };

  brushButtons.forEach((btn) => {
    btn.onclick = () => {
      brushButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const brushVal = parseInt(btn.getAttribute('data-brush') || '1', 10);
      app.workshopBrush = brushVal as TileType;
    };
  });

  btnWsTemplate.onclick = () => {
    app.resetWorkshopGrid(false);
    showToast('已载入经典防线模板');
  };

  btnWsClear.onclick = () => {
    app.resetWorkshopGrid(true);
    showToast('战场已清空');
  };

  btnWsPlay.onclick = () => {
    workshopBar.classList.add('hidden');
    app.launchWorkshopTest();
    beginTouchCombat();
  };

  // Tactical Controls (Home / Camera / Slowmo / Audio)
  btnHome.onclick = () => {
    heroOverlay.classList.remove('hidden');
    workshopBar.classList.add('hidden');
    resultModal.classList.add('hidden');
    hudTop.classList.add('hidden');
    mobileControls.classList.add('hidden');
    document.body.classList.remove('mobile-combat');
    resetTouchUi();
    exitLandscape();
    closeChat();
    chatLog.innerHTML = '';
    app.startHeroDemo();
  };

  btnCamera.onclick = () => {
    const nextPreset = app.cycleCameraPreset();
    btnCamera.textContent =
      nextPreset === 'diorama' ? '沙盘视角' : nextPreset === 'chase' ? '追尾视角' : '自由环视';
    showToast(`视角切换: ${btnCamera.textContent}`);
  };

  btnSlowmo.onclick = () => {
    const on = app.toggleSlowMo();
    btnSlowmo.classList.toggle('active', on);
    showToast(on ? '子弹时间已开启' : '子弹时间已关闭');
  };

  btnAudio.onclick = () => {
    app.audio.unlock();
    const next = !app.audio.enabled;
    app.audio.setEnabled(next);
    btnAudio.classList.toggle('active', next);
    btnAudio.textContent = next ? '音效' : '静音';
    showToast(next ? '音效系统已开启' : '音效已静音');
  };

  // Settings: keyboard turret turn speed
  const TURRET_SPEED_KEY = 'agy_tank_turret_speed';
  const savedTurretSpeed = parseFloat(localStorage.getItem(TURRET_SPEED_KEY) || '');
  if (Number.isFinite(savedTurretSpeed)) {
    app.turretKeyTurnSpeed = Math.min(6, Math.max(1, savedTurretSpeed));
  }
  rangeTurretSpeed.value = app.turretKeyTurnSpeed.toFixed(1);
  turretSpeedValue.textContent = app.turretKeyTurnSpeed.toFixed(1);
  rangeTurretSpeed.addEventListener('input', () => {
    const speed = Math.min(6, Math.max(1, parseFloat(rangeTurretSpeed.value)));
    app.turretKeyTurnSpeed = speed;
    turretSpeedValue.textContent = speed.toFixed(1);
    localStorage.setItem(TURRET_SPEED_KEY, String(speed));
  });

  const closeSettings = () => {
    settingsPopover.classList.add('hidden');
    btnSettings.classList.remove('active');
    btnSettings.setAttribute('aria-expanded', 'false');
  };

  btnSettings.onclick = () => {
    const open = settingsPopover.classList.contains('hidden');
    settingsPopover.classList.toggle('hidden', !open);
    btnSettings.classList.toggle('active', open);
    btnSettings.setAttribute('aria-expanded', String(open));
  };

  document.addEventListener('pointerdown', (e) => {
    if (settingsPopover.classList.contains('hidden')) return;
    const target = e.target as Node;
    if (settingsPopover.contains(target) || btnSettings.contains(target)) return;
    closeSettings();
  });

  // Result Modal Actions
  btnResultNext.onclick = () => {
    resultModal.classList.add('hidden');
    if (canNextStageAction) {
      selectedCampaignStage = Math.min(4, selectedCampaignStage + 1);
      campaignStageButtons.forEach((p, idx) => {
        p.classList.toggle('active', idx === selectedCampaignStage);
      });
      app.startCampaign(selectedCampaignStage);
    } else {
      if (app.mode === 'campaign') {
        app.startCampaign(selectedCampaignStage);
      } else if (app.mode === 'pvp' || app.mode === 'coop') {
        app.hostStartOnlineMatch(app.mode, app.mode === 'pvp' ? selectedPvpMap : selectedCampaignStage);
      }
    }
    beginTouchCombat();
  };

  btnResultMenu.onclick = () => {
    resultModal.classList.add('hidden');
    heroOverlay.classList.remove('hidden');
    workshopBar.classList.add('hidden');
    hudTop.classList.add('hidden');
    mobileControls.classList.add('hidden');
    document.body.classList.remove('mobile-combat');
    resetTouchUi();
    exitLandscape();
    closeChat();
    chatLog.innerHTML = '';
    app.startHeroDemo();
  };
});
