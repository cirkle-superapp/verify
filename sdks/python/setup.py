"""Setup script for the Cirkle Verify Python SDK.

Install with::

    pip install sdks/python/

The package itself is dependency-free for synchronous use. Optional
extras pull in pydantic (typed models) and httpx (async client).
"""

from setuptools import find_packages, setup

setup(
    name="cirkle-verify",
    version="1.0.0",
    description="Python SDK for the Cirkle Identity Verification API",
    long_description=(
        "Cirkle Verify is a self-hosted identity verification platform "
        "(document OCR, face match, liveness, MRZ parsing, GDPR export). "
        "This SDK wraps the REST API with retries, rate-limit handling, "
        "HMAC-SHA256 webhook verification, and typed Pydantic models."
    ),
    long_description_content_type="text/markdown",
    license="MIT",
    packages=find_packages(exclude=("tests", "examples")),
    python_requires=">=3.8",
    install_requires=[],
    extras_require={
        "models": ["pydantic>=2.0.0"],
        "async": ["httpx>=0.24.0"],
        "all": ["pydantic>=2.0.0", "httpx>=0.24.0"],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
)
