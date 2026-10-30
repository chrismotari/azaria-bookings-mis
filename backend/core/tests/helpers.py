def html_part(email):
    """The email's single HTML alternative, checking that it also has a plain-text body."""
    assert email.body
    [(html, mimetype)] = email.alternatives
    assert mimetype == "text/html"
    return html
