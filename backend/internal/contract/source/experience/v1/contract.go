// Package experiencev1 owns ElseLife's immutable canonical boundary bytes and pin.
package experiencev1

import _ "embed"

const Revision = "685758b9009c647f0b6b0da2dbe1769ea6964a71"
const SHA256 = "44f536fc3f4949e7ece9580fee0c3f3178149465df3840e342ecbb0a84cd0a21"
const Path = "internal/contract/source/experience/v1/contract.json"

//go:embed contract.json
var Bytes []byte
