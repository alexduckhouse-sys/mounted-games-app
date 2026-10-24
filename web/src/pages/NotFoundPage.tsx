import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="skin mx-auto w-full max-w-[560px] py-8">
      <section className="mg-card space-y-4 p-6 text-center">
        <h1 className="mg-h1">Page not found</h1>
        <p className="mg-lede">
          We couldn’t find that page. The link may be out of date or the address may have been mistyped.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link to="/events" className="mg-btn mg-btn-primary">
            Browse events
          </Link>
          <Link to="/" className="mg-btn mg-btn-secondary">
            Go to home
          </Link>
        </div>
      </section>
    </div>
  );
}
