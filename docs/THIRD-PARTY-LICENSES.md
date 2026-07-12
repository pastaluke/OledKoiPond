# Third-party licenses

## @paper-design/shaders

The **Paper water** shader cartridge (`src/renderer/cartridges.js`, the
`WATER_FRAG` fragment — specifically the `getCausticNoise` layered-noise caustic
function) is adapted from **@paper-design/shaders**
(https://github.com/paper-design/shaders), licensed under **Apache License 2.0**.

Our version is a derivative: the caustic noise drives a scene refraction plus
animated highlight bands, and we additionally displace by our live ripple height
field. The rest of the compositor and cartridge system is original.

Per the Apache-2.0 terms, the license text and this attribution notice are
retained below.

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

Full license text: https://www.apache.org/licenses/LICENSE-2.0

---

Copyright notice for the adapted portions:
`Copyright (c) Paper Design, licensed under Apache-2.0.`
