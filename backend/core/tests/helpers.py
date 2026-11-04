# The agencies conftest.py creates for the test session. The test client's default host reaches the first.
TEST_SCHEMA = "test"
TEST_DOMAIN = "testserver"
OTHER_SCHEMA = "other"
OTHER_DOMAIN = "other.localhost"


def html_part(email):
    """The email's single HTML alternative, checking that it also has a plain-text body."""
    assert email.body
    [(html, mimetype)] = email.alternatives
    assert mimetype == "text/html"
    return html
