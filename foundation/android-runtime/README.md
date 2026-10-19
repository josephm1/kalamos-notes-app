# Android runtime

Shared Android/WebView infrastructure used by the current apps. This module owns the common shell,
bridge, storage, reader code and handwriting-recognition seam. It talks to hardware only through
`foundation/device-api`.

This is a transitional aggregation, not the final desired granularity. Extract reader, storage,
network and recognition features gradually, with regression tests and app capability declarations;
do not fork them into app directories.

