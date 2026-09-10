export default function handler(req,res){
  res.status(200).json({ok:true,service:'gauley-release-live',version:'1.0.0',time:new Date().toISOString()});
}
