// Direction C — "Tactile Modern"
// Deep green canopy → cream body, big number-forward composition, soft tactile cards.
// Adds: required-note skip flow, and time-at-customer in Done tab.

(function () {
  const C = {
    bg:        '#F1ECE0',
    surface:   '#FFFFFF',
    surfaceAlt:'#F8F3E6',
    ink:       '#171715',
    inkSoft:   '#535048',
    inkMute:   '#928D81',
    green:     '#1B5238',
    greenDeep: '#0D2E1F',
    greenMid:  '#2A6F4A',
    greenSoft: '#DDE9E1',
    greenInk:  '#0E3A24',
    cream:     '#F4ECDB',
    sun:       '#E6B652',
    border:    '#E7DEC9',
    danger:    '#B85A4A',
    dangerSoft:'#F4DCD4',
  };

  function StatusDot({ status }) {
    const map = {
      visited: { c: '#4CAF78', label: 'Visited' },
      active:  { c: C.sun,     label: 'Live' },
      pending: { c: '#C8C0AC', label: '' },
      skipped: { c: C.danger,  label: 'Skipped' },
    }[status] || { c: '#C8C0AC' };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: 999, background: map.c,
          boxShadow: status === 'active' ? `0 0 0 4px ${map.c}33` : 'none',
        }}/>
        {map.label && <span style={{ fontSize: 11, color: C.inkSoft, fontFamily: 'DM Sans, sans-serif', fontWeight: 600 }}>{map.label}</span>}
      </div>
    );
  }

  function fmtMin(m) {
    if (!m && m !== 0) return '—';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60); const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  function StopRow({ stop, idx, expanded, onToggle, photoTaken, onCapturePhoto, onCheckOut, skipState, onStartSkip, onCancelSkip, onChangeSkipNote, onConfirmSkip }) {
    const isActive = stop.status === 'active';
    const isVisited = stop.status === 'visited';
    const isSkipped = stop.status === 'skipped';
    const inSkip = skipState && skipState.mode === 'composing';

    // Retroactive edit (Done tab) — PO/qty/value only; not times/photo
    const [editing, setEditing] = React.useState(false);
    const order = stop.order || { number: '', qty: '', value: '' };
    const [draftPO, setDraftPO] = React.useState(order.number);
    const [draftQty, setDraftQty] = React.useState(String(order.qty));
    const [draftValue, setDraftValue] = React.useState(order.value);
    React.useEffect(() => {
      if (!editing) { setDraftPO(order.number); setDraftQty(String(order.qty)); setDraftValue(order.value); }
    }, [editing, order.number, order.qty, order.value]);

    return (
      <div style={{
        background: isActive ? `linear-gradient(180deg, ${C.surface} 0%, ${C.surfaceAlt} 100%)` : C.surface,
        borderRadius: 22,
        boxShadow: isActive
          ? '0 14px 30px -14px rgba(27,82,56,0.32), 0 1px 0 rgba(255,255,255,0.6) inset'
          : '0 1px 0 rgba(255,255,255,0.7) inset, 0 1px 2px rgba(23,23,21,0.04)',
        border: `1px solid ${isActive ? '#0000' : C.border}`,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {isActive && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: 22, border: `1.5px solid ${C.green}`, pointerEvents: 'none', opacity: 0.85 }}/>
        )}
        <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', position: 'relative' }}>
          <div style={{
            width: 42, height: 42, borderRadius: 14, flexShrink: 0,
            background: isVisited ? C.green : isActive ? C.greenDeep : isSkipped ? C.dangerSoft : C.cream,
            color: isVisited ? '#fff' : isActive ? C.sun : isSkipped ? C.danger : C.inkSoft,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18,
            boxShadow: isActive ? `0 6px 14px -4px ${C.greenDeep}66` : 'none',
          }}>
            {isVisited ? <Icon.Check size={18}/> : isSkipped ? <Icon.Close size={16}/> : idx}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 16, color: C.ink, letterSpacing: -0.2, lineHeight: 1.1 }}>{stop.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <StatusDot status={stop.status}/>
              <span style={{ fontSize: 11, color: C.inkMute, fontFamily: 'DM Sans, sans-serif' }}>· {stop.town}</span>
              {isVisited && (
                <span style={{ fontSize: 11, color: C.inkSoft, fontFamily: 'DM Sans, sans-serif', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  · <Icon.Clock size={11}/> {fmtMin(stop.duration)}
                </span>
              )}
              {isVisited && stop.order && (
                <span style={{ fontSize: 11, color: C.inkMute, fontFamily: 'DM Sans, sans-serif' }}>· {stop.order.value}</span>
              )}
            </div>
          </div>
          <div style={{ color: C.inkMute, transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 320ms cubic-bezier(0.22,0.61,0.36,1)' }}>
            <Icon.ChevDown size={18}/>
          </div>
        </button>

        <Expand open={expanded}>
          <div style={{ padding: '0 18px 18px' }}>
            <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${C.border}, transparent)`, margin: '0 -18px 14px' }}/>

            {/* Stepper as pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px', background: C.cream, borderRadius: 999, marginBottom: 14 }}>
              <StepPill done={!!stop.arrivalTime || isActive} label="Arrived" time={stop.arrivalTime || '10:04'}/>
              <StepPill done={photoTaken || isVisited} label="Photo" time={photoTaken || isVisited ? '✓' : '—'}/>
              <StepPill done={isVisited} label="Order" time={isVisited ? '✓' : '—'}/>
              <StepPill done={!!stop.leavingTime} label="Left" time={stop.leavingTime || '—'}/>
            </div>

            {/* Visited — time-at-stop + order (or inline editor) */}
            {isVisited && !editing && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <DetailCard
                    label="Time at stop"
                    big={fmtMin(stop.duration)}
                    sub={`${stop.arrivalTime} → ${stop.leavingTime}`}
                    icon={<Icon.Clock size={13}/>}
                    locked
                  />
                  {stop.order && (
                    <DetailCard
                      label={`Order ${stop.order.number}`}
                      big={stop.order.value}
                      sub={`${stop.order.qty} units`}
                    />
                  )}
                </div>
                <button onClick={() => setEditing(true)} style={{
                  width: '100%', height: 38, borderRadius: 12, border: `1px solid ${C.border}`,
                  background: C.surface, color: C.inkSoft, cursor: 'pointer',
                  fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 12.5,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <PencilIcon size={13}/> Edit order details
                </button>
              </>
            )}

            {isVisited && editing && (
              <div style={{ background: C.cream, borderRadius: 16, padding: 12, marginBottom: 10, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 700, fontFamily: 'DM Sans, sans-serif' }}>Edit order</div>
                  <div style={{ fontSize: 10, color: C.inkMute, fontFamily: 'DM Sans, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 3 }}><LockIcon size={10}/> Times &amp; photo locked</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.6fr 1fr', gap: 8, marginBottom: 10 }}>
                  <PadInput label="№" value={draftPO} onChange={setDraftPO} placeholder="PO-0000"/>
                  <PadInput label="Qty" value={draftQty} onChange={setDraftQty} inputMode="numeric" placeholder="0"/>
                  <PadInput label="Value" value={draftValue} onChange={setDraftValue} placeholder="R 0,00"/>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 }}>
                  <button onClick={() => setEditing(false)} style={{
                    height: 40, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: 'transparent', color: C.inkSoft,
                    fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 13,
                  }}>Cancel</button>
                  <button onClick={() => setEditing(false)} style={{
                    height: 40, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`, color: '#fff',
                    fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13, letterSpacing: 0.2,
                    boxShadow: `0 8px 16px -8px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}><Icon.Check size={14}/> Save changes</button>
                </div>
              </div>
            )}

            {/* Skipped — show recorded reason */}
            {isSkipped && stop.skipReason && (
              <div style={{ background: C.dangerSoft, borderRadius: 16, padding: 14, marginBottom: 6, border: `1px solid ${C.danger}22` }}>
                <div style={{ fontSize: 10.5, color: C.danger, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 700, fontFamily: 'DM Sans, sans-serif', marginBottom: 4 }}>Skip reason</div>
                <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: C.ink, lineHeight: 1.45 }}>{stop.skipReason}</div>
              </div>
            )}

            {/* Active — order capture + check out OR skip flow */}
            {isActive && !inSkip && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <ChipBtn icon={<Icon.Camera size={15}/>} active={photoTaken} onClick={onCapturePhoto}>{photoTaken ? 'Photo ready' : 'Take photo'}</ChipBtn>
                  <ChipBtn icon={<Icon.Note size={15}/>}>Add note</ChipBtn>
                </div>

                <div style={{ background: C.cream, borderRadius: 16, padding: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 600, fontFamily: 'DM Sans, sans-serif', marginBottom: 8 }}>Order</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.6fr 1fr', gap: 8 }}>
                    <PadField label="№" value="PO-4823"/>
                    <PadField label="Qty" value="36"/>
                    <PadField label="Value" value="R 6 420"/>
                  </div>
                </div>

                <button onClick={onCheckOut} style={{
                  width: '100%', height: 60, borderRadius: 18, border: 'none', cursor: 'pointer',
                  background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`, color: '#fff',
                  fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 17, letterSpacing: 0.3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  boxShadow: `0 12px 28px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset, 0 -1px 0 ${C.greenDeep}88 inset`,
                }}>
                  <Icon.Check size={20}/> Tap to check out
                </button>
                <SkipLink onClick={onStartSkip}/>
              </>
            )}

            {/* Pending — Tap to arrive + secondary skip */}
            {stop.status === 'pending' && !inSkip && (
              <>
                <button style={{
                  width: '100%', height: 56, borderRadius: 18, border: 'none', cursor: 'pointer',
                  background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`, color: '#fff',
                  fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 16, letterSpacing: 0.2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  boxShadow: `0 12px 24px -10px ${C.green}88`,
                }}>
                  <Icon.Pin size={18}/> Tap to check in
                </button>
                <SkipLink onClick={onStartSkip}/>
              </>
            )}

            {/* Skip composer — available from active OR pending */}
            {(isActive || stop.status === 'pending') && inSkip && (
              <SkipComposer
                note={skipState.note}
                onChange={onChangeSkipNote}
                onCancel={onCancelSkip}
                onConfirm={onConfirmSkip}
              />
            )}
          </div>
        </Expand>
      </div>
    );
  }

  function SkipLink({ onClick }) {
    return (
      <button onClick={onClick} style={{
        width: '100%', height: 40, borderRadius: 12, border: 'none', cursor: 'pointer',
        background: 'transparent', color: C.inkSoft, marginTop: 6,
        fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 13,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}><Icon.Skip size={14}/> Mark as skipped</button>
    );
  }

  function SkipComposer({ note, onChange, onCancel, onConfirm }) {
    const valid = (note || '').trim().length >= 3;
    return (
      <div style={{
        background: `linear-gradient(180deg, ${C.dangerSoft} 0%, #FBEFE9 100%)`,
        borderRadius: 18, padding: 14,
        border: `1px solid ${C.danger}33`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 10, background: C.danger, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon.Skip size={14}/>
            </div>
            <div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, color: C.ink, letterSpacing: -0.1 }}>Skip this stop</div>
              <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, color: C.inkSoft }}>A note is required.</div>
            </div>
          </div>
          <button onClick={onCancel} aria-label="Cancel skip" style={{
            width: 28, height: 28, borderRadius: 999, background: 'rgba(255,255,255,0.6)', border: 'none',
            color: C.inkSoft, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon.Close size={14}/>
          </button>
        </div>

        <div style={{
          background: '#fff', borderRadius: 14, padding: 12, border: `1px solid ${C.danger}22`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
        }}>
          <textarea
            value={note}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Why are you skipping this stop?"
            rows={3}
            style={{
              width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'DM Sans, sans-serif', fontSize: 13.5, color: C.ink, lineHeight: 1.45,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <div style={{ fontSize: 10.5, color: C.inkMute, fontFamily: 'DM Sans, sans-serif', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
              {valid ? 'Looks good' : 'Required'}
            </div>
            <div style={{ fontSize: 11, color: C.inkMute, fontFamily: 'DM Sans, sans-serif' }}>{(note || '').length}/240</div>
          </div>
        </div>

        <button
          onClick={valid ? onConfirm : undefined}
          disabled={!valid}
          style={{
            width: '100%', height: 52, borderRadius: 16, border: 'none',
            cursor: valid ? 'pointer' : 'not-allowed', marginTop: 12,
            background: valid ? `linear-gradient(180deg, #C46A57 0%, ${C.danger} 100%)` : 'rgba(184,90,74,0.25)',
            color: '#fff',
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 15, letterSpacing: 0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: valid ? `0 10px 22px -10px ${C.danger}aa, 0 1px 0 rgba(255,255,255,0.15) inset` : 'none',
            opacity: valid ? 1 : 0.85,
            transition: 'background 200ms, box-shadow 200ms',
          }}
        >
          <Icon.Skip size={16}/> Confirm skip
        </button>
      </div>
    );
  }

  function DetailCard({ label, big, sub, icon, locked }) {
    return (
      <div style={{ background: C.surfaceAlt, borderRadius: 16, padding: '12px 14px', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10.5, color: C.inkMute, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 700, fontFamily: 'DM Sans, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {icon}{label}
          </div>
          {locked && <LockIcon size={11} color={C.inkMute}/>}
        </div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, color: C.ink, fontWeight: 700, letterSpacing: -0.4, marginTop: 4, lineHeight: 1 }}>{big}</div>
        {sub && <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11.5, color: C.inkSoft, marginTop: 4 }}>{sub}</div>}
      </div>
    );
  }

  function PencilIcon({ size = 14, color = 'currentColor' }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
      </svg>
    );
  }
  function LockIcon({ size = 12, color = 'currentColor' }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2"/>
        <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
      </svg>
    );
  }

  function PadInput({ label, value, onChange, placeholder, inputMode }) {
    return (
      <label style={{ background: C.surface, borderRadius: 12, padding: '6px 10px', boxShadow: 'inset 0 0 0 1px ' + C.border, display: 'block', cursor: 'text' }}>
        <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'DM Sans, sans-serif' }}>{label}</div>
        <input
          type="text"
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%', border: 'none', outline: 'none', background: 'transparent',
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, color: C.ink,
            padding: 0, marginTop: 1,
          }}
        />
      </label>
    );
  }

  // ── Off-route customer pool (not on today's schedule) ────────────────────
  const OFFROUTE_CUSTOMERS = [
    { id: 'or1', name: 'Hayata Cash & Carry',     code: '#HAY-TZN', town: 'Tzaneen' },
    { id: 'or2', name: 'Africa Cash & Carry',     code: '#AFR-LTB', town: 'Letaba' },
    { id: 'or3', name: 'OK Foods Polokwane',      code: '#OK-PLK',  town: 'Polokwane' },
    { id: 'or4', name: 'Stop n Save',             code: '#SNS-MDK', town: 'Modjadjiskloof' },
    { id: 'or5', name: 'Shoprite Tzaneen Mall',   code: '#SHO-TZN', town: 'Tzaneen' },
    { id: 'or6', name: 'Food Lover\u2019s Market',  code: '#FLM-PLK', town: 'Polokwane' },
  ];

  function OffRouteForm({ onCancel, onSubmit }) {
    const [customerId, setCustomerId] = React.useState('or2'); // demo-selected
    const [search, setSearch] = React.useState('');
    const [open, setOpen] = React.useState(false);
    const [po, setPo] = React.useState('PO-4901');
    const [qty, setQty] = React.useState('18');
    const [val, setVal] = React.useState('R 3 240,00');
    const [notes, setNotes] = React.useState('Pop-up order — buyer requested a top-up before weekend stocktake.');

    const selected = OFFROUTE_CUSTOMERS.find(c => c.id === customerId);
    const filtered = OFFROUTE_CUSTOMERS.filter(c =>
      !search || (c.name + ' ' + c.town).toLowerCase().includes(search.toLowerCase())
    );
    const canSubmit = !!customerId;

    return (
      <div style={{
        background: C.surface, borderRadius: 22,
        border: `1.5px solid ${C.sun}55`,
        boxShadow: `0 14px 30px -14px rgba(230,182,82,0.35), 0 1px 0 rgba(255,255,255,0.7) inset`,
        marginTop: 4, padding: 16, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.sun} 0%, ${C.green} 100%)` }}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 10, background: C.cream, color: C.green,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `inset 0 0 0 1px ${C.sun}44`,
            }}>
              <Icon.Plus size={15}/>
            </div>
            <div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 15, color: C.ink, letterSpacing: -0.2 }}>Off-route order</div>
              <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, color: C.inkSoft }}>Customer not on today's schedule.</div>
            </div>
          </div>
          <button onClick={onCancel} aria-label="Close" style={{
            width: 28, height: 28, borderRadius: 999, background: C.cream, border: 'none',
            color: C.inkSoft, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon.Close size={13}/></button>
        </div>

        {/* Customer field */}
        <div style={{ marginBottom: 12 }}>
          <FieldLabel>Customer</FieldLabel>
          {!open && selected ? (
            <button onClick={() => setOpen(true)} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', background: C.cream, border: `1px solid ${C.border}`,
              borderRadius: 14, cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10, background: C.greenSoft,
                  color: C.greenInk, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13,
                }}>{selected.name.charAt(0)}</div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 14, color: C.ink, letterSpacing: -0.2, lineHeight: 1.1 }}>{selected.name}</div>
                  <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, color: C.inkMute, marginTop: 2 }}>{selected.town} · {selected.code}</div>
                </div>
              </div>
              <Icon.ChevDown size={16}/>
            </button>
          ) : (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
                <Icon.Search size={14} color={C.inkMute}/>
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customer…"
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                    fontFamily: 'DM Sans, sans-serif', fontSize: 13.5, color: C.ink,
                  }}
                />
              </label>
              <div style={{ maxHeight: 168, overflowY: 'auto' }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: C.inkMute, fontSize: 12, fontFamily: 'DM Sans, sans-serif' }}>No customers match "{search}"</div>
                ) : filtered.map(c => (
                  <button key={c.id} onClick={() => { setCustomerId(c.id); setOpen(false); setSearch(''); }} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', background: c.id === customerId ? C.greenSoft : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 9, background: C.cream,
                      color: C.inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, flexShrink: 0,
                    }}>{c.name.charAt(0)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 13.5, color: C.ink, letterSpacing: -0.1, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 10.5, color: C.inkMute, marginTop: 1 }}>{c.town}</div>
                    </div>
                    {c.id === customerId && <Icon.Check size={14} color={C.green}/>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Order */}
        <div style={{ marginBottom: 12 }}>
          <FieldLabel>Order</FieldLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.6fr 1fr', gap: 8 }}>
            <PadInput label="№" value={po} onChange={setPo} placeholder="PO-0000"/>
            <PadInput label="Qty" value={qty} onChange={setQty} inputMode="numeric" placeholder="0"/>
            <PadInput label="Value" value={val} onChange={setVal} placeholder="R 0,00"/>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 12 }}>
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything the office should know about this order…"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 12,
              background: C.surface, border: `1px solid ${C.border}`, outline: 'none', resize: 'none',
              fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: C.ink, lineHeight: 1.45,
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 8 }}>
          <button onClick={onCancel} style={{
            height: 48, borderRadius: 14, border: 'none', cursor: 'pointer',
            background: 'transparent', color: C.inkSoft,
            fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 13,
          }}>Cancel</button>
          <button onClick={canSubmit ? onSubmit : undefined} disabled={!canSubmit} style={{
            height: 48, borderRadius: 14, border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
            background: canSubmit ? `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)` : 'rgba(27,82,56,0.25)',
            color: '#fff',
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 0.2,
            boxShadow: canSubmit ? `0 10px 22px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset` : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}><Icon.Check size={15}/> Log order</button>
        </div>
      </div>
    );
  }

  function UnscheduledForm({ onCancel, onSubmit }) {
    const [customerId, setCustomerId] = React.useState('or1'); // demo-selected: Hayata
    const [search, setSearch] = React.useState('');
    const [open, setOpen] = React.useState(false);
    const [notes, setNotes] = React.useState('Buyer called this morning asking for a drop-in — wants to discuss the new stock line.');

    const selected = OFFROUTE_CUSTOMERS.find(c => c.id === customerId);
    const filtered = OFFROUTE_CUSTOMERS.filter(c =>
      !search || (c.name + ' ' + c.town).toLowerCase().includes(search.toLowerCase())
    );
    const canSubmit = !!customerId;

    return (
      <div style={{
        background: C.surface, borderRadius: 22,
        border: `1.5px solid ${C.green}55`,
        boxShadow: `0 14px 30px -14px ${C.green}55, 0 1px 0 rgba(255,255,255,0.7) inset`,
        marginTop: 4, padding: 16, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.greenMid} 0%, ${C.green} 60%, ${C.greenDeep} 100%)` }}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 10, background: C.greenSoft, color: C.greenInk,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `inset 0 0 0 1px ${C.green}33`,
            }}>
              <Icon.Pin size={14}/>
            </div>
            <div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 15, color: C.ink, letterSpacing: -0.2 }}>Unscheduled visit</div>
              <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, color: C.inkSoft }}>An ad-hoc stop. Logged like any scheduled visit.</div>
            </div>
          </div>
          <button onClick={onCancel} aria-label="Close" style={{
            width: 28, height: 28, borderRadius: 999, background: C.cream, border: 'none',
            color: C.inkSoft, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon.Close size={13}/></button>
        </div>

        {/* Customer field */}
        <div style={{ marginBottom: 12 }}>
          <FieldLabel>Customer</FieldLabel>
          {!open && selected ? (
            <button onClick={() => setOpen(true)} style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', background: C.cream, border: `1px solid ${C.border}`,
              borderRadius: 14, cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10, background: C.greenSoft,
                  color: C.greenInk, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13,
                }}>{selected.name.charAt(0)}</div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 14, color: C.ink, letterSpacing: -0.2, lineHeight: 1.1 }}>{selected.name}</div>
                  <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, color: C.inkMute, marginTop: 2 }}>{selected.town} · {selected.code}</div>
                </div>
              </div>
              <Icon.ChevDown size={16}/>
            </button>
          ) : (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
                <Icon.Search size={14} color={C.inkMute}/>
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search customer…"
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                    fontFamily: 'DM Sans, sans-serif', fontSize: 13.5, color: C.ink,
                  }}
                />
              </label>
              <div style={{ maxHeight: 168, overflowY: 'auto' }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: C.inkMute, fontSize: 12, fontFamily: 'DM Sans, sans-serif' }}>No customers match "{search}"</div>
                ) : filtered.map(c => (
                  <button key={c.id} onClick={() => { setCustomerId(c.id); setOpen(false); setSearch(''); }} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', background: c.id === customerId ? C.greenSoft : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 9, background: C.cream,
                      color: C.inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, flexShrink: 0,
                    }}>{c.name.charAt(0)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 13.5, color: C.ink, letterSpacing: -0.1, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 10.5, color: C.inkMute, marginTop: 1 }}>{c.town}</div>
                    </div>
                    {c.id === customerId && <Icon.Check size={14} color={C.green}/>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Notes (optional) */}
        <div style={{ marginBottom: 12 }}>
          <FieldLabel>Notes <span style={{ color: C.inkMute, fontWeight: 600, letterSpacing: 0 }}>· optional</span></FieldLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Why are you stopping in?"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 12,
              background: C.surface, border: `1px solid ${C.border}`, outline: 'none', resize: 'none',
              fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: C.ink, lineHeight: 1.45,
            }}
          />
        </div>

        {/* What'll happen next — step preview */}
        <div style={{ background: C.cream, borderRadius: 14, padding: '10px 12px', marginBottom: 12, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: 'DM Sans, sans-serif', marginBottom: 6 }}>What happens next</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {['Arrive', 'Photo', 'Order', 'Leave'].map((s, i) => (
              <React.Fragment key={s}>
                <div style={{
                  flex: 1, textAlign: 'center', padding: '5px 0', borderRadius: 999,
                  background: C.surface, boxShadow: '0 1px 2px rgba(23,23,21,0.04)',
                  fontFamily: 'Syne, sans-serif', fontSize: 11, fontWeight: 700, color: C.greenInk, letterSpacing: 0.2,
                }}>{s}</div>
                {i < 3 && <div style={{ width: 6, height: 1, background: C.border }}/>}
              </React.Fragment>
            ))}
          </div>
          <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, color: C.inkSoft, marginTop: 6, lineHeight: 1.4 }}>
            Adds the stop to your day. Times start when you tap arrive.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 8 }}>
          <button onClick={onCancel} style={{
            height: 48, borderRadius: 14, border: 'none', cursor: 'pointer',
            background: 'transparent', color: C.inkSoft,
            fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 13,
          }}>Cancel</button>
          <button onClick={canSubmit ? onSubmit : undefined} disabled={!canSubmit} style={{
            height: 48, borderRadius: 14, border: 'none', cursor: canSubmit ? 'pointer' : 'not-allowed',
            background: canSubmit ? `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)` : 'rgba(27,82,56,0.25)',
            color: '#fff',
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 0.2,
            boxShadow: canSubmit ? `0 10px 22px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset` : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}><Icon.Pin size={14}/> Start visit</button>
        </div>
      </div>
    );
  }

  function FieldLabel({ children }) {
    return (
      <div style={{ fontSize: 10, color: C.inkMute, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 700, fontFamily: 'DM Sans, sans-serif', marginBottom: 6 }}>{children}</div>
    );
  }

  function StepPill({ done, label, time }) {
    return (
      <div style={{
        flex: 1, textAlign: 'center', padding: '7px 4px', borderRadius: 999,
        background: done ? C.surface : 'transparent',
        boxShadow: done ? '0 2px 6px rgba(23,23,21,0.06)' : 'none',
      }}>
        <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'DM Sans, sans-serif', fontWeight: 700 }}>{label}</div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 12, color: done ? C.greenInk : C.inkMute, marginTop: 1, fontWeight: 600 }}>{time}</div>
      </div>
    );
  }

  function ChipBtn({ children, icon, active, onClick }) {
    return (
      <button onClick={onClick} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 44, borderRadius: 14, cursor: 'pointer',
        background: active ? C.greenInk : C.cream,
        color: active ? '#fff' : C.inkSoft,
        border: 'none',
        fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 13,
      }}>{icon}{children}</button>
    );
  }

  function PadField({ label, value }) {
    return (
      <div style={{ background: C.surface, borderRadius: 12, padding: '8px 10px', boxShadow: 'inset 0 0 0 1px ' + C.border }}>
        <div style={{ fontSize: 9.5, color: C.inkMute, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'DM Sans, sans-serif' }}>{label}</div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, color: C.ink, marginTop: 1 }}>{value}</div>
      </div>
    );
  }

  // ── End-of-Day Summary ───────────────────────────────────────────────────────
  function EodSummary({ stats, onClose }) {
    const ordersDelta = stats.histAvgOrders != null ? stats.orders - stats.histAvgOrders : null;
    const valueDelta  = stats.histAvgValue  != null ? stats.totalOrderValue - stats.histAvgValue : null;
    return (
      <div style={{
        position: 'absolute', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'rgba(13,46,31,0.45)', backdropFilter: 'blur(2px)',
      }} onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
        <div style={{
          width: '100%',
          background: `radial-gradient(140% 60% at 50% 0%, ${C.greenSoft} 0%, ${C.surface} 35%, ${C.surface} 100%)`,
          borderTopLeftRadius: 28, borderTopRightRadius: 28,
          padding: '22px 18px 22px',
          boxShadow: '0 -18px 40px -20px rgba(13,46,31,0.4)',
        }}>
          {/* grabber */}
          <div style={{ width: 38, height: 4, borderRadius: 999, background: C.border, margin: '0 auto 14px' }}/>

          {/* Hero */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{
              width: 60, height: 60, borderRadius: 999, margin: '0 auto 10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `radial-gradient(circle at 50% 35%, ${C.greenMid} 0%, ${C.green} 60%, ${C.greenDeep} 100%)`,
              color: '#fff',
              boxShadow: `0 14px 26px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset`,
            }}>
              <Icon.Check size={28}/>
            </div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 24, color: C.ink, letterSpacing: -0.6 }}>Day complete</div>
            <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 12.5, color: C.inkSoft, marginTop: 2 }}>Here's how today went.</div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
            <EodStat label="Scheduled" value={stats.total}/>
            <EodStat label="Visited"   value={stats.visited} tone="green"/>
            <EodStat label="Skipped"   value={stats.skipped} tone={stats.skipped > 0 ? 'danger' : null}/>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <EodStat label="Orders"     value={stats.orders}
              delta={ordersDelta != null ? { value: ordersDelta, base: stats.histAvgOrders, fmt: (v)=>v.toFixed(1) } : null}
              tone="green"
            />
            <EodStat label="Avg time"   value={fmtMin(stats.avgDuration)} tone="ink"/>
          </div>
          <div style={{ marginBottom: 14 }}>
            <EodStat
              label="Order value"
              value={`R ${stats.totalOrderValue.toLocaleString('en-ZA')}`}
              delta={valueDelta != null ? { value: valueDelta, base: stats.histAvgValue, fmt: (v)=>`R ${Math.round(v).toLocaleString('en-ZA')}` } : null}
              tone="green" wide
            />
          </div>

          {/* Done button */}
          <button onClick={onClose} style={{
            width: '100%', height: 56, borderRadius: 18, border: 'none', cursor: 'pointer',
            background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`, color: '#fff',
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 16, letterSpacing: 0.3,
            boxShadow: `0 12px 24px -10px ${C.green}aa, 0 1px 0 rgba(255,255,255,0.2) inset, 0 -1px 0 ${C.greenDeep}88 inset`,
          }}>
            Wrap up
          </button>
        </div>
      </div>
    );
  }

  function EodStat({ label, value, tone, delta, wide }) {
    const valueColor = tone === 'green' ? C.greenInk : tone === 'danger' ? C.danger : C.ink;
    return (
      <div style={{
        background: C.surfaceAlt, borderRadius: 16, padding: '11px 14px',
        border: `1px solid ${C.border}`,
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <div style={{ fontSize: 10, color: C.inkMute, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, fontFamily: 'DM Sans, sans-serif' }}>{label}</div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: wide ? 22 : 20, color: valueColor, fontWeight: 700, letterSpacing: -0.4, lineHeight: 1.05, marginTop: 1 }}>{value}</div>
        {delta && (
          <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 10.5, color: delta.value > 0 ? C.greenInk : delta.value < 0 ? C.danger : C.inkMute, fontWeight: 600, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <span>{delta.value > 0 ? '▲' : delta.value < 0 ? '▼' : '—'}</span>
            <span>Avg this day {delta.fmt(delta.base)}</span>
          </div>
        )}
      </div>
    );
  }

  // ── Main app ─────────────────────────────────────────────────────────────
  function DirectionC({ initialTab = 'active', initialOpenId = 'c3', initialSkip = false, initialSkipId = null, showEod = false, dayCompleteOverride = false, initialBottomCard = null } = {}) {
    const [tab, setTab] = React.useState(initialTab);
    const effectiveOpen = initialSkipId || initialOpenId;
    const [openId, setOpenId] = React.useState(effectiveOpen);
    const [photoTaken, setPhotoTaken] = React.useState(false);
    const [skipForId, setSkipForId] = React.useState(initialSkip ? (initialSkipId || initialOpenId) : null);
    const [skipState, setSkipState] = React.useState(
      initialSkip
        ? { mode: 'composing', note: initialSkipId === 'c4' ? 'Closed for stocktake until Monday — manager confirmed.' : 'Closed' }
        : { mode: 'idle', note: '' }
    );
    const [eodOpen, setEodOpen] = React.useState(showEod);
    const [eodDismissed, setEodDismissed] = React.useState(false);
    const [bottomCard, setBottomCard] = React.useState(initialBottomCard); // 'offroute' | 'unscheduled' | null
    const [extraSkipped, setExtraSkipped] = React.useState([]); // local-only confirmed skips

    const dataset = React.useMemo(() => {
      // For Day-complete demo: mark every remaining stop as visited/skipped
      const base = SCHEDULE_DATA.map(s => {
        const sk = extraSkipped.find(e => e.id === s.id);
        return sk ? { ...s, status: 'skipped', skipReason: sk.note } : s;
      });
      if (!dayCompleteOverride) return base;
      return base.map(s => {
        if (s.id === 'c3') return { ...s, status: 'visited', arrivalTime: '10:04', leavingTime: '10:21', duration: 17, order: { number: 'PO-4823', qty: 36, value: 'R 6 420,00' } };
        if (s.id === 'c4') return { ...s, status: 'skipped', skipReason: 'Closed for stocktake until Monday.' };
        if (s.id === 'c5') return { ...s, status: 'visited', arrivalTime: '11:08', leavingTime: '11:24', duration: 16, order: { number: 'PO-4824', qty: 22, value: 'R 3 880,00' } };
        if (s.id === 'c6') return { ...s, status: 'visited', arrivalTime: '11:52', leavingTime: '12:10', duration: 18, order: { number: 'PO-4825', qty: 14, value: 'R 2 440,00' } };
        return s;
      });
    }, [extraSkipped, dayCompleteOverride]);

    const visited = dataset.filter(s => s.status === 'visited');
    const done = visited.length;
    const total = dataset.length;
    const remaining = dataset.filter(s => s.status !== 'visited' && s.status !== 'skipped').length;
    const pct = done / total;
    const list = tab === 'active'
      ? dataset.filter(s => s.status !== 'visited' && s.status !== 'skipped')
      : dataset.filter(s => s.status === 'visited' || s.status === 'skipped');

    const totalMin = visited.reduce((acc, s) => acc + (s.duration || 0), 0);
    const avgMin = visited.length ? Math.round(totalMin / visited.length) : 0;
    const dayComplete = dataset.length > 0 && dataset.every(s => s.status === 'visited' || s.status === 'skipped');

    return (
      <div style={{ width: '100%', height: '100%', background: C.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* Dark green canopy */}
        <div style={{
          position: 'relative',
          background: `radial-gradient(120% 80% at 50% 0%, ${C.greenMid} 0%, ${C.green} 38%, ${C.greenDeep} 100%)`,
          color: '#fff',
          padding: '30px 18px 12px',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(80% 60% at 100% 0%, rgba(230,182,82,0.18) 0%, transparent 60%)', pointerEvents: 'none' }}/>

          {/* Top header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <BrandMark size={26} color="#fff" accent={C.sun}/>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 15, color: '#fff', letterSpacing: -0.2 }}>Check-In</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(8px)', fontSize: 11.5, fontWeight: 600, color: '#fff' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: '#7DDDA5', boxShadow: '0 0 0 3px rgba(125,221,165,0.25)' }}/>Online
              </div>
              <button style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.14)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <Icon.Menu size={16}/>
              </button>
            </div>
          </div>

          {/* Day strip */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, position: 'relative' }}>
            <button style={canopyNav()}><Icon.ChevLeft size={16}/></button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 600, fontFamily: 'DM Sans, sans-serif' }}>Thursday · Week 2b</div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20, color: '#fff', marginTop: 1, letterSpacing: -0.4 }}>21 May</div>
            </div>
            <button style={canopyNav()}><Icon.ChevRight size={16}/></button>
          </div>

          {/* Massive number row */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 14, marginTop: 10, position: 'relative' }}>
            <BigNum n={done} label="Done" highlight/>
            <Slash/>
            <BigNum n={remaining} label="Remaining"/>
            <Slash/>
            <BigNum n={total} label="Total"/>
          </div>

          {/* Pill-shape progress */}
          <div style={{ marginTop: 8, position: 'relative' }}>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: pct * 100 + '%',
                background: `linear-gradient(90deg, ${C.sun} 0%, #fff 100%)`,
                borderRadius: 999, transition: 'width 700ms cubic-bezier(0.22,0.61,0.36,1)',
              }}/>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ padding: '8px 18px 8px', display: 'flex' }}>
          <div style={{ display: 'flex', background: '#E2D9C6', borderRadius: 999, padding: 4, gap: 4, width: '100%', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)' }}>
            {[['active', 'Active'], ['done', 'Done']].map(([k, l]) => (
              <button key={k} onClick={()=>setTab(k)} style={{
                flex: 1, padding: '8px 0', borderRadius: 999, cursor: 'pointer',
                background: tab === k ? C.surface : 'transparent',
                color: tab === k ? C.ink : C.inkSoft,
                border: 'none', fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13, letterSpacing: 0.2,
                boxShadow: tab === k ? '0 2px 6px rgba(23,23,21,0.08)' : 'none',
                transition: 'background 240ms, color 240ms',
              }}>
                {l} <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 2 }}>{k === 'active' ? dataset.filter(s=>s.status!=='visited' && s.status!=='skipped').length : dataset.filter(s=>s.status==='visited' || s.status==='skipped').length}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Done-tab summary strip */}
        {tab === 'done' && (visited.length > 0 || dataset.some(s => s.status === 'skipped')) && (
          <div style={{ margin: '0 16px 10px', padding: '12px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <SummaryStat label="Avg per stop" value={fmtMin(avgMin)} icon={<Icon.Clock size={12}/>}/>
            <div style={{ width: 1, height: 32, background: C.border }}/>
            <SummaryStat label="Visited" value={String(visited.length)}/>
            <div style={{ width: 1, height: 32, background: C.border }}/>
            <SummaryStat label="Skipped" value={String(dataset.filter(s => s.status === 'skipped').length)}/>
          </div>
        )}

        {/* Day-complete banner — reopens summary */}
        {dayComplete && eodDismissed && !eodOpen && (
          <button onClick={() => setEodOpen(true)} style={{
            margin: '0 16px 10px', padding: '10px 12px',
            background: `linear-gradient(180deg, ${C.greenSoft} 0%, #EFEAD9 100%)`,
            border: `1px solid ${C.green}44`,
            borderRadius: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            boxShadow: '0 1px 0 rgba(255,255,255,0.6) inset',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 999,
                background: `linear-gradient(180deg, ${C.greenMid} 0%, ${C.green} 100%)`,
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 6px 12px -6px ${C.green}aa`,
              }}>
                <Icon.Check size={16}/>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13.5, color: C.greenInk, letterSpacing: -0.1 }}>Day complete</div>
                <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 11, color: C.inkSoft, marginTop: 1 }}>All stops checked in or skipped.</div>
              </div>
            </div>
            <div style={{
              padding: '6px 12px', borderRadius: 999, background: C.surface, border: `1px solid ${C.green}33`,
              color: C.greenInk, fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 11.5,
              display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
            }}>
              View summary <Icon.ChevRight size={12}/>
            </div>
          </button>
        )}

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((s, i) => (
            <StopRow key={s.id} stop={s} idx={i + 1}
              expanded={openId === s.id}
              photoTaken={photoTaken}
              onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              onCapturePhoto={() => setPhotoTaken(p => !p)}
              onCheckOut={() => {}}
              skipState={skipForId === s.id ? skipState : null}
              onStartSkip={() => { setSkipForId(s.id); setSkipState({ mode: 'composing', note: '' }); }}
              onCancelSkip={() => { setSkipForId(null); setSkipState({ mode: 'idle', note: '' }); }}
              onChangeSkipNote={(v) => setSkipState(st => ({ ...st, note: v.slice(0, 240) }))}
              onConfirmSkip={() => {
                if ((skipState.note || '').trim().length < 3) return;
                setExtraSkipped(arr => [...arr, { id: s.id, note: skipState.note.trim() }]);
                setSkipForId(null);
                setSkipState({ mode: 'idle', note: '' });
              }}
            />
          ))}

          {tab === 'active' && bottomCard === null && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
              <button onClick={() => setBottomCard('unscheduled')} style={dashedBtnC()}><Icon.Plus size={14}/>Unscheduled</button>
              <button onClick={() => setBottomCard('offroute')} style={dashedBtnC()}><Icon.Plus size={14}/>Off-route order</button>
            </div>
          )}

          {tab === 'active' && bottomCard === 'offroute' && (
            <OffRouteForm onCancel={() => setBottomCard(null)} onSubmit={() => setBottomCard(null)}/>
          )}
          {tab === 'active' && bottomCard === 'unscheduled' && (
            <UnscheduledForm onCancel={() => setBottomCard(null)} onSubmit={() => setBottomCard(null)}/>
          )}
        </div>

        {eodOpen && (
          <EodSummary
            stats={{
              total: dataset.length,
              visited: dataset.filter(s => s.status === 'visited').length,
              skipped: dataset.filter(s => s.status === 'skipped').length,
              orders: dataset.filter(s => s.status === 'visited' && s.order).length,
              totalOrderValue: dataset
                .filter(s => s.status === 'visited' && s.order)
                .reduce((acc, s) => acc + parseFloat(String(s.order.value).replace(/[^0-9.,]/g, '').replace(/\s/g, '').replace(',', '.')) || 0, 0)
                || 16060,
              avgDuration: (() => {
                const ds = dataset.filter(s => s.status === 'visited' && s.duration);
                if (!ds.length) return 0;
                return Math.round(ds.reduce((a, s) => a + s.duration, 0) / ds.length);
              })(),
              histAvgOrders: 4.2,
              histAvgValue: 14200,
            }}
            onClose={() => { setEodOpen(false); setEodDismissed(true); }}
          />
        )}
      </div>
    );

    function dashedBtnC() {
      return {
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 44, borderRadius: 16, background: 'transparent',
        border: `1.5px dashed ${C.border}`, color: C.inkSoft,
        fontFamily: 'DM Sans, sans-serif', fontWeight: 600, fontSize: 13, cursor: 'pointer',
      };
    }
  }

  function SummaryStat({ label, value, icon }) {
    return (
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: 9.5, color: C.inkMute, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, fontFamily: 'DM Sans, sans-serif', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{icon}{label}</div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, color: C.ink, fontWeight: 700, letterSpacing: -0.3, marginTop: 2 }}>{value}</div>
      </div>
    );
  }

  function BigNum({ n, label, highlight }) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 30, color: highlight ? '#fff' : 'rgba(255,255,255,0.55)', lineHeight: 1, letterSpacing: -0.8 }}>{n}</div>
        <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.7)', letterSpacing: 1.3, textTransform: 'uppercase', fontFamily: 'DM Sans, sans-serif', fontWeight: 600, marginTop: 2 }}>{label}</div>
      </div>
    );
  }
  function Slash() {
    return <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 300, fontSize: 22, color: 'rgba(255,255,255,0.25)', lineHeight: 1, transform: 'translateY(-3px)' }}>/</div>;
  }
  function canopyNav() {
    return {
      width: 30, height: 30, borderRadius: 999, background: 'rgba(255,255,255,0.14)', border: 'none', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    };
  }

  window.DirectionC = DirectionC;
})();
