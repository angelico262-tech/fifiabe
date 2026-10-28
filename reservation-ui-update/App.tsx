import { useEffect, useRef, useState } from 'preact/hooks';
import './index.css';

type Trip = {
  id: string;
  departureAt: string;
  priceAr: number;
  vehicleCode: string;
  availableSeats: number;
  capacity: number;
  route: string;
};

type Seat = { number: number; occupied: boolean };
type BookingStep = 'search' | 'results' | 'seats' | 'details' | 'confirmed';

const API = 'http://127.0.0.1:3000';
const STEP_ORDER: BookingStep[] = ['search', 'results', 'seats', 'details', 'confirmed'];

function stepIsReached(current: BookingStep, target: BookingStep) {
  return STEP_ORDER.indexOf(current) >= STEP_ORDER.indexOf(target);
}

function BookingApp() {
  const [backend, setBackend] = useState('Vérification…');
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('Tana');
  const [to, setTo] = useState('Sambava');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [searchCanRetry, setSearchCanRetry] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [seatLoading, setSeatLoading] = useState(false);
  const [seatMessage, setSeatMessage] = useState('');
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [bookingMessage, setBookingMessage] = useState('');
  const [bookingCanRetry, setBookingCanRetry] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [confirmedSeats, setConfirmedSeats] = useState<number[]>([]);
  const [bookingStep, setBookingStep] = useState<BookingStep>('search');

  const resultsRef = useRef<HTMLElement>(null);
  const seatsRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);

  function scrollTo(ref: { current: HTMLElement | null }) {
    window.setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  useEffect(() => {
    fetch(`${API}/health`)
      .then((response) => response.json())
      .then((data) => {
        if (data.status === 'ok') {
          setBackend('Backend OK');
        }
      })
      .catch(() => setBackend('Backend indisponible'));
  }, []);

  function readableError(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    if (message.toLowerCase().includes('connexion temporaire') || message.includes('P1001')) {
      return 'Connexion temporairement indisponible. Votre demande n’a pas été perdue ; réessayez dans quelques secondes.';
    }
    return message || fallback;
  }

  async function searchTrips(event?: Event) {
    event?.preventDefault();
    setMessage('');
    setSearchCanRetry(false);
    setTrips([]);
    setSelectedTrip(null);
    setSeats([]);
    setSelectedSeats([]);
    setBookingMessage('');
    setSeatMessage('');
    setConfirmedSeats([]);
    setBookingStep('search');

    if (!date) {
      setMessage('Choisissez une date de départ.');
      return;
    }

    const direction = from === 'Tana' ? 'TANA_TO_SAVA' : 'SAVA_TO_TANA';
    setLoading(true);

    try {
      const response = await fetch(`${API}/api/trips?date=${date}&direction=${direction}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Recherche impossible');

      setTrips(data);
      setSearchCanRetry(false);
      setBookingStep('results');
      setMessage(data.length ? `${data.length} départ${data.length > 1 ? 's' : ''} disponible${data.length > 1 ? 's' : ''}. Choisissez maintenant votre véhicule.` : 'Aucun départ disponible à cette date.');
      scrollTo(resultsRef);
    } catch (error) {
      setMessage(readableError(error, 'Impossible de charger les départs. Vérifiez que le backend est lancé.'));
      setSearchCanRetry(true);
    } finally {
      setLoading(false);
    }
  }

  async function chooseTrip(trip: Trip) {
    setSelectedTrip(trip);
    setSelectedSeats([]);
    setBookingMessage('');
    setSeatMessage('');
    setConfirmedSeats([]);
    setBookingStep('seats');
    setSeatLoading(true);
    scrollTo(seatsRef);

    try {
      const response = await fetch(`${API}/api/trips/${trip.id}/seats`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Plan indisponible');
      setSeats(data.seats);
    } catch (error) {
      setSeatMessage(readableError(error, 'Impossible de charger le plan des sièges.'));
    } finally {
      setSeatLoading(false);
    }
  }

  function toggleSeat(seat: Seat) {
    if (seat.occupied) return;
    setBookingMessage('');
    setSelectedSeats((current) => (
      current.includes(seat.number)
        ? current.filter((number) => number !== seat.number)
        : [...current, seat.number].sort((a, b) => a - b)
    ));
  }

  function continueToDetails() {
    if (!selectedSeats.length) {
      setBookingMessage('Sélectionnez au moins un siège pour continuer.');
      return;
    }
    setBookingMessage('');
    setBookingStep('details');
    scrollTo(detailsRef);
  }

  async function submitBooking(event?: Event) {
    event?.preventDefault();
    setBookingMessage('');
    setBookingCanRetry(false);

    if (!selectedTrip || selectedSeats.length === 0) {
      setBookingMessage('Sélectionnez au moins un siège.');
      return;
    }

    setBookingLoading(true);
    const reservedSeats = [...selectedSeats];

    try {
      const response = await fetch(`${API}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId: selectedTrip.id,
          passengerName,
          passengerPhone,
          seatNumbers: reservedSeats,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Réservation impossible');

      setSeats((current) => current.map((seat) => (
        reservedSeats.includes(seat.number) ? { ...seat, occupied: true } : seat
      )));
      setConfirmedSeats(reservedSeats);
      setSelectedSeats([]);
      setPassengerName('');
      setPassengerPhone('');
      setBookingStep('confirmed');
      scrollTo(confirmationRef);
    } catch (error) {
      setBookingMessage(readableError(error, 'Réservation impossible.'));
      setBookingCanRetry(true);
    } finally {
      setBookingLoading(false);
    }
  }

  function closeBooking() {
    setSelectedTrip(null);
    setSeats([]);
    setSelectedSeats([]);
    setBookingMessage('');
    setSeatMessage('');
    setConfirmedSeats([]);
    setBookingStep(trips.length ? 'results' : 'search');
    scrollTo(resultsRef);
  }

  const seatMap = new Map(seats.map((seat) => [seat.number, seat]));
  const renderSeat = (number: number) => {
    const seat = seatMap.get(number) ?? { number, occupied: false };
    const isSelected = selectedSeats.includes(number);
    const status = seat.occupied ? 'Occupé' : isSelected ? 'Sélectionné' : 'Libre';

    return (
      <button
        type="button"
        key={number}
        disabled={seat.occupied}
        onClick={() => toggleSeat(seat)}
        aria-label={`Siège ${number} : ${status}`}
        className={`min-h-14 rounded-xl border-2 px-3 py-2 text-lg font-black transition focus:outline-none focus:ring-4 focus:ring-orange-200 ${
          seat.occupied
            ? 'cursor-not-allowed border-fifiabe-red bg-red-100 text-fifiabe-red'
            : isSelected
              ? 'border-fifiabe-green bg-fifiabe-green text-white shadow-md'
              : 'border-stone-300 bg-white text-fifiabe-brown hover:-translate-y-0.5 hover:border-fifiabe-orange hover:shadow-sm'
        }`}
      >
        {number}
      </button>
    );
  };

  return (
    <main className="min-h-screen bg-fifiabe-cream text-fifiabe-ink">
      <header className="bg-fifiabe-brown text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <div>
            <p className="text-xs uppercase tracking-[.3em] text-orange-200">Coopérative</p>
            <h1 className="text-3xl font-black">FIFIABE</h1>
          </div>
          <div className="flex items-center gap-3">
            <a href="/admin" className="rounded-full border border-white/25 px-4 py-2 text-sm font-bold transition hover:bg-white/10">Gestion</a>
            <span className="rounded-full bg-white/10 px-4 py-2 text-sm">{backend}</span>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-14 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <p className="mb-4 font-semibold uppercase tracking-widest text-fifiabe-orange">Tana ↔ SAVA</p>
          <h2 className="max-w-xl text-5xl font-black leading-tight text-fifiabe-brown">Voyagez sereinement entre la capitale et le Nord-Est.</h2>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">Réservez votre place dans nos taxi-brousse de 17 places. Le hub de Sambava relie Antalaha, Andapa, Ampanefena et Vohemar.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <span className="rounded-full bg-orange-100 px-4 py-2 text-sm font-bold text-fifiabe-orange">Mardi · Jeudi · Samedi</span>
            <span className="rounded-full bg-red-100 px-4 py-2 text-sm font-bold text-fifiabe-red">Départ 13h00</span>
            <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-bold text-fifiabe-green">50 000 Ar</span>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-7 shadow-xl shadow-fifiabe-brown/10">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-2xl font-black text-fifiabe-brown">Rechercher un voyage</h3>
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-fifiabe-orange">Étape 1</span>
          </div>
          <form className="mt-6 grid gap-4" onSubmit={searchTrips}>
            <label className="grid gap-2 text-sm font-bold">Départ
              <select value={from} onChange={(e) => setFrom((e.currentTarget as HTMLSelectElement).value)} className="rounded-xl border border-orange-100 bg-fifiabe-cream p-3">
                <option>Tana</option><option>Sambava</option><option>Antalaha</option><option>Andapa</option><option>Ampanefena</option><option>Vohemar</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold">Destination
              <select value={to} onChange={(e) => setTo((e.currentTarget as HTMLSelectElement).value)} className="rounded-xl border border-orange-100 bg-fifiabe-cream p-3">
                <option>Sambava</option><option>Tana</option><option>Antalaha</option><option>Andapa</option><option>Ampanefena</option><option>Vohemar</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold">Date
              <input required type="date" value={date} onChange={(e) => setDate((e.currentTarget as HTMLInputElement).value)} className="rounded-xl border border-orange-100 bg-fifiabe-cream p-3" />
            </label>
            <button disabled={loading} className="rounded-xl bg-fifiabe-orange px-5 py-3 font-black text-white transition hover:bg-fifiabe-red disabled:cursor-wait disabled:opacity-60">
              {loading ? 'Recherche des départs en cours…' : 'Voir les départs disponibles'}
            </button>
          </form>
          {message && (
            <div role="status" aria-live="polite" className={`mt-4 rounded-xl p-3 text-sm font-semibold ${trips.length ? 'bg-green-50 text-fifiabe-green' : 'bg-red-50 text-fifiabe-red'}`}>
              <p>{message}</p>
              {searchCanRetry && <button type="button" onClick={() => searchTrips()} disabled={loading} className="mt-3 rounded-lg border border-current px-3 py-2 text-sm font-black transition hover:bg-white/60 disabled:opacity-60">Réessayer la recherche</button>}
            </div>
          )}
        </div>
      </section>

      {trips.length > 0 && (
        <section ref={resultsRef} className="mx-auto mb-12 max-w-6xl scroll-mt-6 px-5">
          <div className="rounded-3xl bg-white p-7 shadow-xl shadow-fifiabe-brown/10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-fifiabe-orange">Étape 2 sur 4</p>
                <h3 className="text-2xl font-black text-fifiabe-brown">Choisissez votre départ</h3>
              </div>
              <span className="rounded-full bg-green-50 px-4 py-2 text-sm font-black text-fifiabe-green">Recherche validée</span>
            </div>
            <p className="mt-2 text-slate-600">Les départs disponibles s’affichent ici automatiquement après votre recherche.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {trips.map((trip) => (
                <article className="rounded-2xl border border-orange-100 bg-fifiabe-cream p-4" key={trip.id}>
                  <div className="flex items-center justify-between">
                    <strong>{new Date(trip.departureAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong>
                    <span className="font-bold text-fifiabe-green">{trip.availableSeats}/{trip.capacity} places</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{trip.route} · {trip.vehicleCode}</p>
                  <p className="mt-2 font-black text-fifiabe-brown">{trip.priceAr.toLocaleString('fr-FR')} Ar</p>
                  <button type="button" onClick={() => chooseTrip(trip)} className="mt-3 w-full rounded-xl bg-fifiabe-red px-4 py-2 font-bold text-white transition hover:bg-fifiabe-brown">
                    Choisir ce véhicule et mes sièges
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {selectedTrip && (
        <section ref={seatsRef} className="mx-auto mb-12 max-w-6xl scroll-mt-6 px-5">
          <div className="rounded-3xl bg-white p-7 shadow-xl shadow-fifiabe-brown/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-fifiabe-orange">Étape 3 sur 4 · {selectedTrip.vehicleCode}</p>
                <h3 className="text-2xl font-black text-fifiabe-brown">Choisissez vos sièges</h3>
                <p className="mt-1 text-sm text-slate-600">Plan du taxi-brousse : conducteur à l’avant, couloir central et banquette arrière.</p>
              </div>
              <button type="button" onClick={closeBooking} className="rounded-xl border border-slate-200 px-4 py-2 font-bold transition hover:border-fifiabe-orange hover:text-fifiabe-brown">Changer de départ</button>
            </div>

            <div className="mt-5 grid gap-2 rounded-2xl border border-orange-100 bg-fifiabe-cream p-4 sm:grid-cols-4">
              {[
                ['1', 'Départ', true],
                ['2', 'Véhicule', true],
                ['3', 'Places', stepIsReached(bookingStep, 'seats')],
                ['4', 'Confirmation', stepIsReached(bookingStep, 'confirmed')],
              ].map(([number, label, active]) => (
                <div key={number as string} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-black ${active ? 'bg-white text-fifiabe-green shadow-sm' : 'text-slate-400'}`}>
                  <span className={`grid h-7 w-7 place-items-center rounded-full ${active ? 'bg-fifiabe-green text-white' : 'bg-slate-200 text-slate-500'}`}>{number}</span>
                  {label as string}
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-4 text-sm font-bold">
              <span className="flex items-center gap-2"><i className="h-3 w-3 rounded-sm border border-stone-300 bg-white" /> Libre</span>
              <span className="flex items-center gap-2 text-fifiabe-green"><i className="h-3 w-3 rounded-sm bg-fifiabe-green" /> Sélectionné</span>
              <span className="flex items-center gap-2 text-fifiabe-red"><i className="h-3 w-3 rounded-sm bg-fifiabe-red" /> Occupé</span>
            </div>

            {seatLoading ? (
              <div role="status" aria-live="polite" className="mt-6 rounded-2xl bg-orange-50 p-5 font-bold text-fifiabe-brown">Chargement du plan des sièges…</div>
            ) : (
              <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_.7fr]">
                <div className="rounded-3xl border-4 border-fifiabe-brown bg-stone-100 p-4 sm:p-6">
                  <div className="mb-4 grid grid-cols-[1.4fr_.35fr_1fr] gap-3">
                    <div className="rounded-xl bg-stone-300 px-3 py-4 text-center text-sm font-black text-fifiabe-brown">Volant<br />Conducteur</div>
                    <div aria-hidden="true" />
                    {renderSeat(1)}
                  </div>
                  <p className="mb-3 text-center text-xs font-bold uppercase tracking-widest text-stone-500">Avant du véhicule</p>

                  <div className="space-y-3">
                    {[[2, 3, 4], [5, 6, 7], [8, 9, 10], [11, 12, 13]].map(([leftA, leftB, right]) => (
                      <div key={leftA} className="grid grid-cols-[1.4fr_.35fr_1fr] gap-3">
                        <div className="grid grid-cols-2 gap-3">{renderSeat(leftA)}{renderSeat(leftB)}</div>
                        <div className="flex items-center justify-center text-[10px] font-black uppercase tracking-[.18em] text-stone-400 [writing-mode:vertical-rl]">Couloir</div>
                        {renderSeat(right)}
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 border-t-2 border-dashed border-stone-300 pt-4">
                    <p className="mb-3 text-center text-xs font-bold uppercase tracking-widest text-stone-500">Banquette arrière</p>
                    <div className="grid grid-cols-4 gap-3">{[14, 15, 16, 17].map(renderSeat)}</div>
                  </div>
                </div>

                <aside className="grid content-start gap-4">
                  <div role="status" aria-live="polite" className="rounded-2xl bg-green-50 p-4 text-fifiabe-green">
                    <p className="text-sm font-black uppercase tracking-wider">Votre sélection</p>
                    <p className="mt-2 text-lg font-black">{selectedSeats.length ? `Siège${selectedSeats.length > 1 ? 's' : ''} ${selectedSeats.join(', ')}` : 'Aucun siège choisi'}</p>
                    <p className="mt-1 text-sm">{selectedSeats.length ? 'Votre choix est pris en compte. Continuez pour saisir vos coordonnées.' : 'Cliquez sur une place blanche pour la sélectionner.'}</p>
                  </div>
                  <button type="button" onClick={continueToDetails} disabled={!selectedSeats.length} className="rounded-xl bg-fifiabe-orange px-5 py-3 font-black text-white transition hover:bg-fifiabe-red disabled:cursor-not-allowed disabled:opacity-50">
                    {selectedSeats.length ? `Continuer avec ${selectedSeats.length} siège${selectedSeats.length > 1 ? 's' : ''}` : 'Sélectionnez un siège pour continuer'}
                  </button>
                  {seatMessage && (
                    <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-fifiabe-red">
                      <p>{seatMessage}</p>
                      <button type="button" onClick={() => chooseTrip(selectedTrip)} disabled={seatLoading} className="mt-3 rounded-lg border border-current px-3 py-2 text-sm font-black transition hover:bg-white/60 disabled:opacity-60">Recharger le plan des sièges</button>
                    </div>
                  )}
                </aside>
              </div>
            )}
          </div>
        </section>
      )}

      {selectedTrip && stepIsReached(bookingStep, 'details') && bookingStep !== 'confirmed' && (
        <section ref={detailsRef} className="mx-auto mb-12 max-w-4xl scroll-mt-6 px-5">
          <div className="rounded-3xl bg-white p-7 shadow-xl shadow-fifiabe-brown/10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-fifiabe-orange">Étape 4 sur 4</p>
                <h3 className="text-2xl font-black text-fifiabe-brown">Vos informations de réservation</h3>
              </div>
              <span className="rounded-full bg-green-50 px-4 py-2 text-sm font-black text-fifiabe-green">Sièges validés : {selectedSeats.join(', ')}</span>
            </div>
            <p className="mt-2 text-slate-600">Vérifiez vos coordonnées puis confirmez. Le bouton affiche l’état de l’enregistrement afin que vous sachiez immédiatement que votre demande est en cours.</p>
            <form onSubmit={submitBooking} className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">Nom complet
                <input required value={passengerName} onInput={(e) => setPassengerName((e.currentTarget as HTMLInputElement).value)} className="rounded-xl border border-orange-100 bg-fifiabe-cream p-3" placeholder="Ex. Jean Rakoto" />
              </label>
              <label className="grid gap-2 text-sm font-bold">Téléphone
                <input required value={passengerPhone} onInput={(e) => setPassengerPhone((e.currentTarget as HTMLInputElement).value)} className="rounded-xl border border-orange-100 bg-fifiabe-cream p-3" placeholder="Ex. 032 00 000 00" />
              </label>
              <div className="md:col-span-2">
                <button disabled={bookingLoading} className="w-full rounded-xl bg-fifiabe-orange px-5 py-3 font-black text-white transition hover:bg-fifiabe-red disabled:cursor-wait disabled:opacity-60">
                  {bookingLoading ? 'Enregistrement sécurisé de votre réservation…' : 'Confirmer la réservation'}
                </button>
              </div>
              {bookingMessage && (
                <div role="alert" className="md:col-span-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-fifiabe-red">
                  <p>{bookingMessage}</p>
                  {bookingCanRetry && <button type="button" onClick={() => chooseTrip(selectedTrip)} disabled={bookingLoading} className="mt-3 rounded-lg border border-current px-3 py-2 text-sm font-black transition hover:bg-white/60 disabled:opacity-60">Actualiser les sièges avant de confirmer à nouveau</button>}
                </div>
              )}
            </form>
          </div>
        </section>
      )}

      {bookingStep === 'confirmed' && selectedTrip && (
        <section ref={confirmationRef} className="mx-auto mb-12 max-w-4xl scroll-mt-6 px-5">
          <div role="status" aria-live="polite" className="rounded-3xl border border-green-200 bg-green-50 p-8 text-center shadow-xl shadow-fifiabe-brown/10">
            <p className="text-sm font-black uppercase tracking-widest text-fifiabe-green">Réservation confirmée</p>
            <h3 className="mt-2 text-3xl font-black text-fifiabe-brown">Votre place est enregistrée.</h3>
            <p className="mx-auto mt-4 max-w-xl text-slate-700">Merci. Le véhicule {selectedTrip.vehicleCode} vous attend pour votre trajet. Siège{confirmedSeats.length > 1 ? 's' : ''} réservé{confirmedSeats.length > 1 ? 's' : ''} : <strong>{confirmedSeats.join(', ')}</strong>.</p>
            <button type="button" onClick={closeBooking} className="mt-6 rounded-xl bg-fifiabe-brown px-5 py-3 font-black text-white transition hover:bg-fifiabe-red">Retour aux départs</button>
          </div>
        </section>
      )}

      <section className="bg-fifiabe-brown px-5 py-12 text-white">
        <div className="mx-auto max-w-6xl">
          <h3 className="text-2xl font-black">Nos étapes SAVA → Tana</h3>
          <p className="mt-3 text-white/75">Antalaha → Andapa → Sambava → Ampanefena → Vohemar → Tana</p>
        </div>
      </section>
    </main>
  );
}


type AdminBooking = {
  id: string;
  passengerName: string;
  passengerPhone: string;
  seats: number[];
  createdAt: string;
  departureAt: string;
  vehicleCode: string;
  route: string;
  status: string;
};

function AdminApp() {
  const [token, setToken] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [date, setDate] = useState('');
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    const savedToken = sessionStorage.getItem('fifiabe_admin_token');
    const savedName = sessionStorage.getItem('fifiabe_admin_name');
    if (savedToken) {
      setToken(savedToken);
      setAdminName(savedName ?? 'Administrateur FIFIABE');
      void loadBookings(savedToken, '');
    }
  }, []);

  async function readResponse(response: Response) {
    try {
      return await response.json() as { message?: string; token?: string; fullName?: string; [key: string]: unknown };
    } catch {
      return { message: 'Réponse serveur invalide. Réessayez dans quelques instants.' };
    }
  }

  async function loadBookings(sessionToken = token, requestedDate = date) {
    if (!sessionToken) return;
    setLoading(true);
    setMessage('');
    try {
      const query = requestedDate ? `?date=${encodeURIComponent(requestedDate)}` : '';
      const response = await fetch(`${API}/api/admin/bookings${query}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await readResponse(response);
      if (!response.ok) {
        if (response.status === 401) {
          sessionStorage.removeItem('fifiabe_admin_token');
          sessionStorage.removeItem('fifiabe_admin_name');
          setToken('');
          setAdminName('');
          setBookings([]);
          throw new Error('Votre session a expiré. Connectez-vous de nouveau.');
        }
        throw new Error(data.message ?? 'Impossible de charger les réservations.');
      }
      setBookings(data as unknown as AdminBooking[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Impossible de charger les réservations.');
    } finally {
      setLoading(false);
    }
  }

  async function login(event: Event) {
    event.preventDefault();
    setLoginLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await readResponse(response);
      if (!response.ok || !data.token) throw new Error(data.message ?? 'Connexion impossible.');

      const newToken = data.token;
      const newName = data.fullName ?? 'Administrateur FIFIABE';
      sessionStorage.setItem('fifiabe_admin_token', newToken);
      sessionStorage.setItem('fifiabe_admin_name', newName);
      setToken(newToken);
      setAdminName(newName);
      setPassword('');
      await loadBookings(newToken, '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connexion impossible.');
    } finally {
      setLoginLoading(false);
    }
  }

  function logout() {
    sessionStorage.removeItem('fifiabe_admin_token');
    sessionStorage.removeItem('fifiabe_admin_name');
    setToken('');
    setAdminName('');
    setBookings([]);
    setMessage('');
  }

  const reservedSeats = bookings.reduce((total, booking) => total + booking.seats.length, 0);

  if (!token) {
    return (
      <main className="min-h-screen bg-fifiabe-cream text-fifiabe-ink">
        <header className="bg-fifiabe-brown text-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
            <div><p className="text-xs uppercase tracking-[.3em] text-orange-200">Espace privé</p><h1 className="text-3xl font-black">FIFIABE Gestion</h1></div>
            <a href="/" className="rounded-xl border border-white/25 px-4 py-2 text-sm font-bold transition hover:bg-white/10">Retour aux réservations</a>
          </div>
        </header>
        <section className="mx-auto grid max-w-5xl gap-10 px-5 py-16 lg:grid-cols-[1fr_.8fr]">
          <div className="self-center">
            <p className="font-bold uppercase tracking-widest text-fifiabe-orange">Accès réservé</p>
            <h2 className="mt-3 max-w-lg text-5xl font-black leading-tight text-fifiabe-brown">Suivez les départs et les passagers.</h2>
            <p className="mt-5 max-w-lg text-lg leading-8 text-slate-600">Cet espace est réservé aux administrateurs de la coopérative. Les réservations publiques restent séparées de ce tableau de gestion.</p>
          </div>
          <form onSubmit={login} className="rounded-3xl bg-white p-7 shadow-xl shadow-fifiabe-brown/10">
            <p className="text-sm font-bold uppercase tracking-widest text-fifiabe-orange">Connexion administrateur</p>
            <h3 className="mt-2 text-2xl font-black text-fifiabe-brown">Ouvrir le tableau de bord</h3>
            <label className="mt-6 grid gap-2 text-sm font-bold">Adresse e-mail
              <input required type="email" autoComplete="username" value={email} onInput={(event) => setEmail((event.currentTarget as HTMLInputElement).value)} className="rounded-xl border border-orange-100 bg-fifiabe-cream p-3" placeholder="admin@fifiabe.mg" />
            </label>
            <label className="mt-4 grid gap-2 text-sm font-bold">Mot de passe
              <input required type="password" autoComplete="current-password" value={password} onInput={(event) => setPassword((event.currentTarget as HTMLInputElement).value)} className="rounded-xl border border-orange-100 bg-fifiabe-cream p-3" placeholder="Votre mot de passe" />
            </label>
            <button disabled={loginLoading} className="mt-6 w-full rounded-xl bg-fifiabe-red px-5 py-3 font-black text-white transition hover:bg-fifiabe-brown disabled:cursor-wait disabled:opacity-60">{loginLoading ? 'Vérification sécurisée…' : 'Se connecter'}</button>
            {message && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-fifiabe-red">{message}</p>}
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-fifiabe-cream text-fifiabe-ink">
      <header className="bg-fifiabe-brown text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div><p className="text-xs uppercase tracking-[.3em] text-orange-200">Espace privé</p><h1 className="text-3xl font-black">FIFIABE Gestion</h1></div>
          <div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-white/10 px-4 py-2 text-sm">Connecté : {adminName}</span><a href="/" className="rounded-xl border border-white/25 px-4 py-2 text-sm font-bold transition hover:bg-white/10">Réservations publiques</a><button type="button" onClick={logout} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-fifiabe-brown transition hover:bg-orange-100">Déconnexion</button></div>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div><p className="font-bold uppercase tracking-widest text-fifiabe-orange">Tableau de bord</p><h2 className="mt-2 text-4xl font-black text-fifiabe-brown">Réservations et départs</h2><p className="mt-2 text-slate-600">Consultez les passagers, leurs contacts et les sièges attribués par véhicule.</p></div>
          <form className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm" onSubmit={(event) => { event.preventDefault(); void loadBookings(); }}>
            <label className="grid gap-2 text-sm font-bold">Date de départ
              <input type="date" value={date} onInput={(event) => setDate((event.currentTarget as HTMLInputElement).value)} className="rounded-xl border border-orange-100 bg-fifiabe-cream p-3" />
            </label>
            <button disabled={loading} className="rounded-xl bg-fifiabe-orange px-5 py-3 font-black text-white transition hover:bg-fifiabe-red disabled:opacity-60">{loading ? 'Actualisation…' : 'Filtrer'}</button>
            {date && <button type="button" onClick={() => { setDate(''); void loadBookings(token, ''); }} className="rounded-xl border border-slate-200 px-4 py-3 font-bold transition hover:border-fifiabe-orange">Tout afficher</button>}
          </form>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-sm font-bold uppercase tracking-wider text-slate-500">Réservations</p><p className="mt-2 text-4xl font-black text-fifiabe-brown">{bookings.length}</p></div>
          <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-sm font-bold uppercase tracking-wider text-slate-500">Places attribuées</p><p className="mt-2 text-4xl font-black text-fifiabe-green">{reservedSeats}</p></div>
          <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-sm font-bold uppercase tracking-wider text-slate-500">Période affichée</p><p className="mt-3 text-lg font-black text-fifiabe-brown">{date ? new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Tous les départs'}</p></div>
        </div>

        {message && <div role="alert" className="mt-6 rounded-2xl bg-red-50 p-4 font-bold text-fifiabe-red"><p>{message}</p><button type="button" onClick={() => void loadBookings()} className="mt-3 rounded-lg border border-current px-3 py-2 text-sm font-black transition hover:bg-white/60">Réessayer</button></div>}

        <section className="mt-8 overflow-hidden rounded-3xl bg-white shadow-xl shadow-fifiabe-brown/10">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-100 px-6 py-5"><div><h3 className="text-2xl font-black text-fifiabe-brown">Liste des passagers</h3><p className="mt-1 text-sm text-slate-600">Les sièges sont affichés pour chaque réservation confirmée.</p></div><button type="button" onClick={() => void loadBookings()} disabled={loading} className="rounded-xl border border-orange-200 px-4 py-2 font-bold text-fifiabe-brown transition hover:bg-orange-50 disabled:opacity-60">Actualiser</button></div>
          {loading ? <p role="status" className="p-8 font-bold text-fifiabe-brown">Chargement sécurisé des réservations…</p> : bookings.length === 0 ? <div className="p-10 text-center"><p className="text-xl font-black text-fifiabe-brown">Aucune réservation pour cette sélection.</p><p className="mt-2 text-slate-600">Choisissez une autre date ou attendez les premières réservations clients.</p></div> : <div className="overflow-x-auto"><table className="min-w-full text-left"><thead className="bg-fifiabe-cream text-xs uppercase tracking-wider text-slate-600"><tr><th className="px-5 py-4">Départ</th><th className="px-5 py-4">Véhicule</th><th className="px-5 py-4">Passager</th><th className="px-5 py-4">Téléphone</th><th className="px-5 py-4">Sièges</th><th className="px-5 py-4">Réservé le</th></tr></thead><tbody className="divide-y divide-orange-50">{bookings.map((booking) => <tr key={booking.id} className="hover:bg-orange-50/40"><td className="px-5 py-4 font-bold text-fifiabe-brown"><p>{new Date(booking.departureAt).toLocaleDateString('fr-FR')}</p><p className="text-sm font-normal text-slate-500">{new Date(booking.departureAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {booking.route}</p></td><td className="px-5 py-4 font-black text-fifiabe-brown">{booking.vehicleCode}</td><td className="px-5 py-4 font-bold">{booking.passengerName}</td><td className="px-5 py-4"><a className="font-bold text-fifiabe-red underline decoration-red-200 underline-offset-4" href={`tel:${booking.passengerPhone}`}>{booking.passengerPhone}</a></td><td className="px-5 py-4"><span className="rounded-full bg-green-100 px-3 py-1 text-sm font-black text-fifiabe-green">{booking.seats.join(', ')}</span></td><td className="px-5 py-4 text-sm text-slate-600">{new Date(booking.createdAt).toLocaleString('fr-FR')}</td></tr>)}</tbody></table></div>}
        </section>
      </section>
    </main>
  );
}

export function App() {
  return window.location.pathname === '/admin' ? <AdminApp /> : <BookingApp />;
}
