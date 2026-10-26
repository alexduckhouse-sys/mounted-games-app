import { Link, useNavigate } from 'react-router-dom';
import '../components/sitePages.css';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="skin mx-auto w-full max-w-[560px]">
      <div className="sp-small">
        <h1>Page not found</h1>
        <p>We couldn’t find that page. The link may be old or mistyped.</p>
        <div className="sp-acts">
          <Link to="/events" className="sp-pill sp-pill-fill">See competitions</Link>
          <button type="button" className="sp-pill" onClick={() => navigate(-1)}>Go back</button>
        </div>
      </div>
    </div>
  );
}
